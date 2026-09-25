<script context="module">
	import { PYODIDE_WORKSPACE_DIRECTORY } from '$lib/pyodide/workspace';

	let savedPyodidePath = PYODIDE_WORKSPACE_DIRECTORY;
</script>

<script lang="ts">
	import { getContext, onMount, onDestroy, tick } from 'svelte';
	import { toast } from 'svelte-sonner';
	import { chatId, pyodideWorker, showFileNavPath } from '$lib/stores';
	import { createPyodideWorker } from '$lib/pyodide/createPyodideWorker';
	import { terminatePyodideWorker } from '$lib/pyodide/runtimeTimeouts';
	import { requestPyodideFile, type PyodideFileRequest } from '$lib/pyodide/workerRequest';
	import {
		asPyodideWorkspaceDirectory,
		getPyodideWorkspaceBreadcrumbs,
		getPyodideWorkspacePath,
		isValidPyodideEntryName
	} from '$lib/pyodide/workspace';
	import type { FileEntry } from '$lib/apis/terminal';

	import FileNavToolbar from './FileNav/FileNavToolbar.svelte';
	import FileEntryRow from './FileNav/FileEntryRow.svelte';
	import FilePreview from './FileNav/FilePreview.svelte';
	import ConfirmDialog from '../common/ConfirmDialog.svelte';
	import Spinner from '../common/Spinner.svelte';
	import Folder from '../icons/Folder.svelte';
	import Document from '../icons/Document.svelte';
	import { isWorkspaceOpenRequestForChat } from './Artifacts/workspace';

	const i18n = getContext('i18n');

	export let overlay = false;
	export let onOpenFile: (
		path: string,
		options?: { page?: number | null; fileId?: string | null }
	) => boolean = () => false;

	// ── State ─────────────────────────────────────────────────────────────
	let currentPath = savedPyodidePath;
	let entries: FileEntry[] = [];
	let sortBy: 'name' | 'size' | 'date' = 'name';
	let sortAsc = true;
	let showHidden = false;
	let loading = false;
	let error: string | null = null;
	let startupStage: string | null = null;

	let selectedFile: string | null = null;
	let fileLoading = false;
	let fileContent: string | null = null;
	let fileImageUrl: string | null = null;

	let isDragOver = false;
	let showDeleteConfirm = false;
	let deletePath = '';
	let deleteName = '';

	let creatingFolder = false;
	let newFolderName = '';
	let newFolderInput: HTMLInputElement;

	let creatingFile = false;
	let newFileName = '';
	let newFileInput: HTMLInputElement;

	// ── Navigation history ──────────────────────────────────────────────────
	type NavEntry = { path: string; file: string | null };
	let navHistory: NavEntry[] = [];
	let navIndex = -1;
	let navigatingHistory = false;

	$: canGoBack = navIndex > 0;
	$: canGoForward = navIndex < navHistory.length - 1;

	const pushNavHistory = (path: string, file: string | null = null) => {
		if (navigatingHistory) return;
		const current = navHistory[navIndex];
		if (current && current.path === path && current.file === file) return;
		if (navIndex < navHistory.length - 1) {
			navHistory = navHistory.slice(0, navIndex + 1);
		}
		navHistory = [...navHistory, { path, file }];
		navIndex = navHistory.length - 1;
	};

	const goBack = async () => {
		if (!canGoBack) return;
		navigatingHistory = true;
		navIndex -= 1;
		const entry = navHistory[navIndex];
		await loadDir(entry.path);
		if (entry.file) {
			const fileName = entry.file.split('/').pop() ?? '';
			await openEntry({ name: fileName, type: 'file', size: 0 });
		}
		navigatingHistory = false;
	};

	const goForward = async () => {
		if (!canGoForward) return;
		navigatingHistory = true;
		navIndex += 1;
		const entry = navHistory[navIndex];
		await loadDir(entry.path);
		if (entry.file) {
			const fileName = entry.file.split('/').pop() ?? '';
			await openEntry({ name: fileName, type: 'file', size: 0 });
		}
		navigatingHistory = false;
	};

	let directoryRequestId = 0;
	let fileRequestId = 0;
	let filesChangedRequestId = 0;

	const FILE_PREVIEW_MAX_BYTES = 16 * 1024 * 1024;
	const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'ico', 'avif']);
	const isImage = (path: string) => IMAGE_EXTS.has(path.split('.').pop()?.toLowerCase() ?? '');
	$: visibleEntries = entries
		.filter((entry) => showHidden || !entry.name.startsWith('.'))
		.sort((a, b) => {
			if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
			let comparison = 0;
			if (sortBy === 'size') comparison = (a.size ?? 0) - (b.size ?? 0);
			else if (sortBy === 'date') comparison = (a.modified ?? 0) - (b.modified ?? 0);
			else comparison = a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
			return sortAsc ? comparison : -comparison;
		});

	const toggleSort = (mode: 'name' | 'size' | 'date') => {
		if (sortBy === mode) sortAsc = !sortAsc;
		else {
			sortBy = mode;
			sortAsc = true;
		}
	};

	// ── Worker management ─────────────────────────────────────────────────

	function ensureWorker(): Worker {
		let worker = $pyodideWorker;
		if (!worker) {
			worker = createPyodideWorker();
			pyodideWorker.set(worker);
		}
		return worker;
	}

	async function sendWorkerMessage(msg: PyodideFileRequest) {
		const worker = ensureWorker();
		try {
			return await requestPyodideFile(worker, msg, {
				onProgress: (stage) => {
					startupStage = stage;
				},
				onWorkerError: () => {
					if ($pyodideWorker === worker) pyodideWorker.set(null);
				},
				onTimeout: () => {
					if ($pyodideWorker === worker) {
						terminatePyodideWorker(worker, 'Pyodide stopped after a file request timed out');
						pyodideWorker.set(null);
					}
				}
			});
		} finally {
			startupStage = null;
		}
	}

	// ── Breadcrumbs ───────────────────────────────────────────────────────

	$: breadcrumbs = getPyodideWorkspaceBreadcrumbs(currentPath);

	// ── Operations ────────────────────────────────────────────────────────

	const loadDir = async (
		path: string,
		options: { preserveSelection?: boolean; recordHistory?: boolean } = {}
	) => {
		const requestId = ++directoryRequestId;
		const previousPath = currentPath;
		loading = true;
		error = null;
		if (!options.preserveSelection) {
			fileRequestId += 1;
			selectedFile = null;
			clearPreview();
		}
		const requestedPath = asPyodideWorkspaceDirectory(path);
		currentPath = requestedPath;

		try {
			const res = await sendWorkerMessage({
				type: 'fs:list',
				path: requestedPath.replace(/\/$/, '') || '/'
			});
			if (requestId !== directoryRequestId) return;
			entries = res.entries || [];
			savedPyodidePath = requestedPath;
			if (options.recordHistory !== false) pushNavHistory(requestedPath);
		} catch (loadError) {
			if (requestId !== directoryRequestId) return;
			const failure = loadError instanceof Error ? loadError.message : String(loadError);
			if (
				requestedPath !== PYODIDE_WORKSPACE_DIRECTORY &&
				!/timed out|worker failed|stopped/i.test(failure)
			) {
				console.warn('Pyodide directory is unavailable; returning to Files home', loadError);
				currentPath = PYODIDE_WORKSPACE_DIRECTORY;
				savedPyodidePath = PYODIDE_WORKSPACE_DIRECTORY;
				await loadDir(PYODIDE_WORKSPACE_DIRECTORY, options);
				return;
			}
			console.error('Failed to list Pyodide directory', loadError);
			currentPath = previousPath;
			error = $i18n.t('Files are currently unavailable');
			entries = [];
		} finally {
			if (requestId === directoryRequestId) loading = false;
		}
	};

	const refreshDirectory = async () => {
		loading = true;
		error = null;
		try {
			await sendWorkerMessage({ type: 'fs:sync' });
		} catch (syncError) {
			console.error('Failed to synchronize Pyodide files', syncError);
		}
		if (selectedFile) {
			const name = selectedFile.split('/').pop() ?? '';
			try {
				await openEntry({ name, type: 'file', size: 0 });
			} finally {
				loading = false;
			}
		} else {
			await loadDir(currentPath);
		}
	};

	const openEntry = async (entry: FileEntry, notifyWorkspace = true) => {
		if (entry.type === 'directory') {
			await loadDir(`${currentPath}${entry.name}/`);
			return;
		}

		const filePath = `${currentPath}${entry.name}`;
		if (notifyWorkspace && onOpenFile(filePath)) return;
		pushNavHistory(currentPath, filePath);
		const requestId = ++fileRequestId;
		selectedFile = filePath;
		fileLoading = true;
		clearPreview();

		try {
			const res = await sendWorkerMessage({
				type: 'fs:read',
				path: filePath,
				maxBytes: FILE_PREVIEW_MAX_BYTES
			});
			if (requestId !== fileRequestId) return;
			if (res.error) {
				fileContent = `Error: ${res.error}`;
			} else if (isImage(filePath)) {
				const blob = new Blob([res.data]);
				const nextUrl = URL.createObjectURL(blob);
				if (requestId !== fileRequestId) URL.revokeObjectURL(nextUrl);
				else fileImageUrl = nextUrl;
			} else {
				const decoder = new TextDecoder('utf-8', { fatal: true });
				try {
					fileContent = decoder.decode(res.data);
				} catch {
					fileContent = `[Binary file: ${entry.size ?? 0} bytes]`;
				}
			}
		} catch (readError) {
			if (requestId === fileRequestId) {
				console.error('Failed to read Pyodide file', readError);
				fileContent = String(readError).includes('File exceeds the read limit')
					? $i18n.t('This file is too large to preview. Download it instead.')
					: $i18n.t('Failed to read file');
			}
		} finally {
			if (requestId === fileRequestId) fileLoading = false;
		}
	};

	const openRequestedFile = async (
		request: string | { path: string; page?: number | null; fileId?: string | null }
	) => {
		const filePath = typeof request === 'string' ? request : request.path;
		const normalized = getPyodideWorkspacePath(
			filePath.startsWith('/') ? filePath : `${currentPath}${filePath}`
		);
		if (!normalized) return;
		const separator = normalized.lastIndexOf('/');
		const directory = separator >= 0 ? normalized.slice(0, separator + 1) || '/' : currentPath;
		const name = normalized.slice(separator + 1);
		if (!name) return;
		if (onOpenFile(normalized, typeof request === 'string' ? {} : request)) {
			return;
		}
		await loadDir(directory);
		await openEntry({ name, type: 'file', size: 0 }, false);
	};

	const clearPreview = () => {
		fileContent = null;
		if (fileImageUrl) {
			URL.revokeObjectURL(fileImageUrl);
			fileImageUrl = null;
		}
	};

	const downloadFile = async (path: string) => {
		try {
			const res = await sendWorkerMessage({ type: 'fs:read', path });
			if (res.data) {
				const blob = new Blob([res.data]);
				const url = URL.createObjectURL(blob);
				const a = document.createElement('a');
				a.href = url;
				a.download = path.split('/').pop() ?? 'file';
				a.style.display = 'none';
				document.body.appendChild(a);
				a.click();
				a.remove();
				window.setTimeout(() => URL.revokeObjectURL(url), 0);
			}
		} catch (e) {
			console.error('Download failed:', e);
			toast.error($i18n.t('Download failed'));
		}
	};

	const confirmDelete = (path: string, name: string) => {
		deletePath = path;
		deleteName = name;
		showDeleteConfirm = true;
	};

	const doDelete = async () => {
		try {
			await sendWorkerMessage({ type: 'fs:delete', path: deletePath });
			window.dispatchEvent(
				new CustomEvent('pyodide:files', {
					detail: { paths: [deletePath], kind: 'deleted' }
				})
			);
			if (selectedFile === deletePath) {
				selectedFile = null;
				clearPreview();
			}
			await loadDir(currentPath);
		} catch (e) {
			console.error('Delete failed:', e);
			toast.error($i18n.t('Delete failed'));
		}
	};

	const startNewFolder = async () => {
		creatingFolder = true;
		newFolderName = '';
		await tick();
		newFolderInput?.focus();
	};

	const submitNewFolder = async () => {
		if (!creatingFolder) return;
		const name = newFolderName.trim();
		creatingFolder = false;
		newFolderName = '';
		if (!name) return;
		if (!isValidPyodideEntryName(name)) {
			toast.error($i18n.t('Enter a valid name without slashes.'));
			return;
		}
		const folderPath = `${currentPath}${name}`.replace(/\/$/, '');
		try {
			await sendWorkerMessage({ type: 'fs:mkdir', path: folderPath });
			await loadDir(currentPath);
		} catch (e) {
			console.error('Failed to create folder:', e);
			toast.error($i18n.t('Folder could not be created'));
		}
	};

	const startNewFile = async () => {
		creatingFile = true;
		newFileName = '';
		await tick();
		newFileInput?.focus();
	};

	const submitNewFile = async () => {
		if (!creatingFile) return;
		const name = newFileName.trim();
		creatingFile = false;
		newFileName = '';
		if (!name) return;
		if (!isValidPyodideEntryName(name)) {
			toast.error($i18n.t('Enter a valid name without slashes.'));
			return;
		}
		try {
			await sendWorkerMessage({
				type: 'fs:upload',
				files: [{ name, data: new ArrayBuffer(0) }],
				dir: currentPath.replace(/\/$/, '') || '/'
			});
			await loadDir(currentPath);
		} catch (e) {
			console.error('Failed to create file:', e);
			toast.error($i18n.t('File could not be created'));
		}
	};

	const uploadFiles = async (fileList: File[]) => {
		const payloads: { name: string; data: ArrayBuffer }[] = [];
		for (const file of fileList) {
			if (!isValidPyodideEntryName(file.name)) {
				toast.error($i18n.t('One or more file names are invalid.'));
				continue;
			}
			payloads.push({ name: file.name, data: await file.arrayBuffer() });
		}
		if (!payloads.length) return;
		try {
			await sendWorkerMessage({
				type: 'fs:upload',
				files: payloads,
				dir: currentPath.replace(/\/$/, '') || '/'
			});
		} catch (e) {
			console.error('Upload failed:', e);
			toast.error($i18n.t('Upload failed'));
			return;
		}
		await loadDir(currentPath);
	};

	// ── Drag and drop ─────────────────────────────────────────────────────

	const handleDragOver = (e: DragEvent) => {
		if (selectedFile) return;
		if (!e.dataTransfer?.types.includes('Files')) return;
		e.preventDefault();
		e.stopPropagation();
		isDragOver = true;
	};

	const handleDrop = async (e: DragEvent) => {
		e.preventDefault();
		e.stopPropagation();
		isDragOver = false;
		if (selectedFile) return;
		const droppedFiles = Array.from(e.dataTransfer?.files ?? []);
		if (droppedFiles.length) await uploadFiles(droppedFiles);
	};

	// ── Lifecycle ─────────────────────────────────────────────────────────

	const onFilesChanged = async (event: Event) => {
		const requestId = ++filesChangedRequestId;
		const detail = (event as CustomEvent<{ paths?: string[]; kind?: string }>).detail;
		const changedPaths = Array.isArray(detail?.paths) ? detail.paths : [];
		if (detail?.kind === 'deleted' && selectedFile && changedPaths.includes(selectedFile)) {
			fileRequestId += 1;
			selectedFile = null;
			clearPreview();
		}
		try {
			await sendWorkerMessage({ type: 'fs:sync' });
		} catch (syncError) {
			console.error('Failed to synchronize changed Pyodide files', syncError);
		}
		if (requestId !== filesChangedRequestId) return;
		const fileToRefresh = selectedFile;
		const directoryToRefresh = currentPath;
		await loadDir(directoryToRefresh, {
			preserveSelection: Boolean(fileToRefresh),
			recordHistory: false
		});
		if (
			requestId !== filesChangedRequestId ||
			currentPath !== directoryToRefresh ||
			selectedFile !== fileToRefresh
		)
			return;
		if (
			fileToRefresh &&
			!entries.some(
				(entry) => entry.type === 'file' && `${currentPath}${entry.name}` === fileToRefresh
			)
		) {
			fileRequestId += 1;
			selectedFile = null;
			clearPreview();
			return;
		}
		if (fileToRefresh && (!changedPaths.length || changedPaths.includes(fileToRefresh))) {
			await openEntry({ name: fileToRefresh.split('/').pop() ?? '', type: 'file', size: 0 }, false);
		}
	};

	let unsubscribeDisplayFile: (() => void) | null = null;

	onMount(() => {
		ensureWorker();
		loadDir(currentPath);
		window.addEventListener('pyodide:files', onFilesChanged);
		unsubscribeDisplayFile = showFileNavPath.subscribe((request) => {
			if (!request) return;
			if (typeof request === 'object' && !isWorkspaceOpenRequestForChat(request.chatId, $chatId)) {
				showFileNavPath.set(null);
				return;
			}
			if (typeof request === 'object' && request.fileId) return;
			showFileNavPath.set(null);
			void openRequestedFile(request);
		});
	});

	onDestroy(() => {
		filesChangedRequestId += 1;
		directoryRequestId += 1;
		fileRequestId += 1;
		window.removeEventListener('pyodide:files', onFilesChanged);
		unsubscribeDisplayFile?.();
	});
</script>

<ConfirmDialog
	bind:show={showDeleteConfirm}
	title={$i18n.t('Delete {{name}}', { name: deleteName })}
	message={$i18n.t('Are you sure you want to delete this?')}
	on:confirm={doDelete}
/>

<div
	class="flex flex-col h-full min-h-0 min-w-0 relative"
	on:dragover={handleDragOver}
	on:dragleave={() => (isDragOver = false)}
	on:drop={handleDrop}
	role="region"
	aria-label={$i18n.t('Pyodide file browser')}
>
	{#if isDragOver}
		<div
			class="absolute inset-0 z-10 flex flex-col items-center justify-center bg-white/80 dark:bg-gray-850/80 backdrop-blur-sm pointer-events-none gap-1.5"
		>
			<svg
				xmlns="http://www.w3.org/2000/svg"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="1.5"
				class="size-5 text-gray-400 dark:text-gray-500"
			>
				<path
					stroke-linecap="round"
					stroke-linejoin="round"
					d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5"
				/>
			</svg>
			<span class="text-xs text-gray-400 dark:text-gray-500">{$i18n.t('Drop files here')}</span>
		</div>
	{/if}

	{#if overlay}
		<div class="absolute inset-0 z-10 pointer-events-none"></div>
	{/if}

	<!-- Toolbar (shared with FileNav) -->
	<FileNavToolbar
		{breadcrumbs}
		{selectedFile}
		{loading}
		{canGoBack}
		{canGoForward}
		{sortBy}
		{sortAsc}
		{showHidden}
		onGoBack={goBack}
		onGoForward={goForward}
		onNavigate={(path) => loadDir(path)}
		onRefresh={refreshDirectory}
		onNewFolder={startNewFolder}
		onNewFile={startNewFile}
		onUploadFiles={uploadFiles}
		onSort={toggleSort}
		onToggleHidden={() => (showHidden = !showHidden)}
		allowDirectoryDownload={false}
		allowMove={false}
	>
		<!-- File action buttons when a file is selected (slot content) -->
		<button
			class="shrink-0 p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 transition text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-400"
			on:click={() => selectedFile && downloadFile(selectedFile)}
			aria-label={$i18n.t('Download')}
		>
			<svg
				xmlns="http://www.w3.org/2000/svg"
				viewBox="0 0 20 20"
				fill="currentColor"
				class="size-3.5"
			>
				<path
					d="M10.75 2.75a.75.75 0 0 0-1.5 0v8.614L6.295 8.235a.75.75 0 1 0-1.09 1.03l4.25 4.5a.75.75 0 0 0 1.09 0l4.25-4.5a.75.75 0 0 0-1.09-1.03l-2.955 3.129V2.75Z"
				/>
				<path
					d="M3.5 12.75a.75.75 0 0 0-1.5 0v2.5A2.75 2.75 0 0 0 4.75 18h10.5A2.75 2.75 0 0 0 18 15.25v-2.5a.75.75 0 0 0-1.5 0v2.5c0 .69-.56 1.25-1.25 1.25H4.75c-.69 0-1.25-.56-1.25-1.25v-2.5Z"
				/>
			</svg>
		</button>
	</FileNavToolbar>

	<!-- Content area -->
	<div class="flex-1 min-h-0 flex flex-col">
		{#if selectedFile}
			<FilePreview {selectedFile} {fileLoading} {fileImageUrl} {fileContent} {overlay} />
		{:else if loading}
			<div
				class="flex flex-1 items-center justify-center gap-2 p-6 text-xs text-gray-500 dark:text-gray-400"
				data-pyodide-stage={startupStage ?? 'waiting'}
				role="status"
			>
				<Spinner className="size-4" />
				<span>{$i18n.t(startupStage ? 'Preparing Files' : 'Loading')}</span>
			</div>
		{:else if error}
			<div class="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
				<div class="text-sm text-gray-500 dark:text-gray-400">{error}</div>
				<button
					type="button"
					class="rounded-md border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 transition hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
					on:click={refreshDirectory}
				>
					{$i18n.t('Retry')}
				</button>
			</div>
		{:else if visibleEntries.length === 0 && !creatingFolder && !creatingFile}
			<div class="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
				<div
					class="mb-1 flex size-10 items-center justify-center rounded-lg border border-gray-100 bg-gray-50 text-gray-400 dark:border-gray-800 dark:bg-gray-800/50 dark:text-gray-500"
				>
					<Folder className="size-5" />
				</div>
				<div class="text-sm font-medium text-gray-700 dark:text-gray-300">
					{entries.length > 0 ? $i18n.t('No files found') : $i18n.t('Files')}
				</div>
				{#if entries.length === 0}
					<div class="max-w-72 text-xs leading-5 text-gray-400 dark:text-gray-500">
						{$i18n.t('No files yet. Upload files or run Python code to create them.')}
					</div>
				{/if}
				{#if entries.length > 0}
					<button
						type="button"
						class="mt-1 rounded-md px-2.5 py-1.5 text-xs font-medium text-gray-600 transition hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
						on:click={() => (showHidden = true)}
					>
						{$i18n.t('Show Hidden Files')}
					</button>
				{/if}
			</div>
		{/if}

		{#if !loading && !error && !selectedFile}
			{#if visibleEntries.length > 0 || creatingFolder || creatingFile}
				<div class="min-h-0 flex-1 overflow-y-auto">
					<div class="w-full px-1 pt-2 pb-4">
						{#if creatingFolder}
							<div class="flex min-h-7 items-center gap-2.5 px-2.5 py-1">
								<Folder className="size-4 shrink-0 text-blue-400 dark:text-blue-300" />
								<input
									bind:this={newFolderInput}
									bind:value={newFolderName}
									class="flex-1 text-xs bg-transparent border border-gray-200 dark:border-gray-700 rounded px-1.5 py-0.5 outline-none focus:border-blue-400 dark:focus:border-blue-500"
									placeholder={$i18n.t('Folder name')}
									on:keydown={(e) => {
										if (e.key === 'Enter') submitNewFolder();
										if (e.key === 'Escape') {
											creatingFolder = false;
											newFolderName = '';
										}
									}}
									on:blur={submitNewFolder}
								/>
							</div>
						{/if}
						{#if creatingFile}
							<div class="flex min-h-7 items-center gap-2.5 px-2.5 py-1">
								<Document className="size-4 shrink-0 text-gray-400 dark:text-gray-500" />
								<input
									bind:this={newFileInput}
									bind:value={newFileName}
									class="flex-1 text-xs bg-transparent border border-gray-200 dark:border-gray-700 rounded px-1.5 py-0.5 outline-none focus:border-blue-400 dark:focus:border-blue-500"
									placeholder={$i18n.t('File name')}
									on:keydown={(e) => {
										if (e.key === 'Enter') submitNewFile();
										if (e.key === 'Escape') {
											creatingFile = false;
											newFileName = '';
										}
									}}
									on:blur={submitNewFile}
								/>
							</div>
						{/if}

						<ul>
							{#each visibleEntries as entry (entry.name)}
								<FileEntryRow
									{entry}
									{currentPath}
									draggableEnabled={false}
									onOpen={openEntry}
									onDownload={downloadFile}
									onDelete={confirmDelete}
								/>
							{/each}
						</ul>
					</div>
				</div>
			{/if}
		{/if}
	</div>
</div>
