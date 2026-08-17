<script lang="ts">
	import { getContext, onDestroy, onMount } from 'svelte';
	import type { Writable } from 'svelte/store';
	import type { i18n as i18nType } from 'i18next';
	import { toast } from 'svelte-sonner';
	import JSZip from 'jszip';

	import { selectTransientWebPreview, updateTransientWebPreview } from '$lib/apis/chats';
	import { createDirectory, getCwd, uploadToTerminal } from '$lib/apis/terminal';
	import { createPyodideWorker } from '$lib/pyodide/createPyodideWorker';
	import {
		artifactContents,
		pyodideWorker,
		selectedTerminalId,
		terminalServers
	} from '$lib/stores';
	import { injectCsp } from '$lib/utils/csp';
	import Tooltip from '$lib/components/common/Tooltip.svelte';
	import FileCodeEditor from '../FileNav/FileCodeEditor.svelte';
	import CodeBracket from '$lib/components/icons/CodeBracket.svelte';
	import Download from '$lib/components/icons/Download.svelte';
	import Eye from '$lib/components/icons/Eye.svelte';
	import Folder from '$lib/components/icons/Folder.svelte';
	import Refresh from '$lib/components/icons/Refresh.svelte';
	import type { WebPreviewArtifact, WebPreviewFile } from './webPreview';
	import { composeWebPreviewHtml, mergeLocalWebPreviewDraft } from './webPreview';
	import { buildWebPreviewSandbox } from './webPreviewSandbox';
	import { resolveWorkspaceRuntime } from './workspace';
	import { createSerializedSaveQueue, registerWorkspaceSaveBarrier } from './serializedSaveQueue';

	const i18n: Writable<i18nType> = getContext('i18n');
	export let artifact: WebPreviewArtifact;
	export let chatId = '';
	export let codeInterpreterEnabled = false;
	export let iframeCsp = '';
	export let sandboxAllowForms = false;
	export let sandboxAllowSameOrigin = false;

	let mode: 'preview' | 'code' = 'preview';
	let title = artifact.title;
	let entrypoint = artifact.entrypoint;
	let files: Record<string, WebPreviewFile> = structuredClone(artifact.files);
	let selectedPath = entrypoint;
	let reloadKey = 0;
	let dirty = false;
	let saving = false;
	let exporting = false;
	let lastUpdatedAt = artifact.updatedAt ?? 0;
	let exportedPath = artifact.exportedPath ?? '';
	let exportedRuntime = artifact.exportedRuntime ?? '';
	let workerRequestId = 0;
	let saveFailed = false;
	let retryCount = 0;
	let lastArtifact = artifact;
	let unregisterSaveBarrier = () => {};
	let localRevision = 0;
	let lastSaveBaseVersion: number | undefined;
	let lastSavedVersion: number | undefined;
	let lastContentHash = artifact.contentHash;
	let lastSaveBaseHash: string | undefined;
	let lastSavedHash: string | undefined;

	$: selectedFile = files[selectedPath] ?? files[entrypoint];
	$: previewHtml = composeWebPreviewHtml(files, entrypoint);
	$: previewError = !files[entrypoint]
		? $i18n.t('The preview entrypoint is missing')
		: files[entrypoint].mime !== 'text/html'
			? $i18n.t('The preview entrypoint must be an HTML file')
			: '';
	$: workspaceRuntime = resolveWorkspaceRuntime(
		$terminalServers,
		$selectedTerminalId,
		codeInterpreterEnabled
	);
	$: runtimeTerminal =
		workspaceRuntime.kind === 'terminal'
			? (($terminalServers ?? []).find((item) => item.id === workspaceRuntime.terminalId) ?? null)
			: null;
	$: filesAvailable = workspaceRuntime.writable;

	$: if (artifact !== lastArtifact && (artifact.updatedAt ?? 0) >= lastUpdatedAt && !dirty) {
		lastArtifact = artifact;
		title = artifact.title;
		entrypoint = artifact.entrypoint;
		files = structuredClone(artifact.files);
		selectedPath = files[selectedPath] ? selectedPath : entrypoint;
		lastUpdatedAt = artifact.updatedAt ?? 0;
		lastContentHash = artifact.contentHash ?? lastContentHash;
		exportedPath = artifact.exportedPath ?? '';
		exportedRuntime = artifact.exportedRuntime ?? '';
		reloadKey += 1;
	}

	type PreviewSaveSnapshot = {
		title: string;
		entrypoint: string;
		files: Record<string, WebPreviewFile>;
		exportedPath: string;
		exportedRuntime: string;
		expectedUpdatedAt?: number;
		expectedContentHash?: string;
		notifyExport?: boolean;
		revision: number;
	};

	const updateSharedDraft = () => {
		(artifactContents as any).update((items: any[] | null) =>
			(items ?? []).map((item) =>
				item?.previewId === artifact.previewId
					? mergeLocalWebPreviewDraft(item, { title, entrypoint, files: structuredClone(files) })
					: item
			)
		);
	};

	const buildSaveSnapshot = (exportMeta?: {
		path: string;
		runtime: string;
	}): PreviewSaveSnapshot => ({
		title,
		entrypoint,
		files: structuredClone(files),
		exportedPath: exportMeta?.path ?? exportedPath,
		exportedRuntime: exportMeta?.runtime ?? exportedRuntime,
		expectedUpdatedAt: lastUpdatedAt || undefined,
		expectedContentHash: lastContentHash,
		notifyExport: Boolean(exportMeta),
		revision: localRevision
	});

	const saveSnapshot = async (snapshot: PreviewSaveSnapshot) => {
		if (!chatId) return;
		saving = true;
		try {
			const expectedUpdatedAt =
				snapshot.expectedUpdatedAt === lastSaveBaseVersion
					? lastSavedVersion
					: snapshot.expectedUpdatedAt;
			const expectedContentHash =
				snapshot.expectedContentHash === lastSaveBaseHash
					? lastSavedHash
					: snapshot.expectedContentHash;
			const updated = await updateTransientWebPreview(
				localStorage.token,
				chatId,
				artifact.previewId,
				{
					title: snapshot.title,
					entrypoint: snapshot.entrypoint,
					files: snapshot.files,
					exported_path: snapshot.exportedPath || null,
					exported_runtime: snapshot.exportedRuntime || null,
					expected_updated_at: expectedUpdatedAt ?? null,
					expected_content_hash: expectedContentHash ?? null
				}
			);
			lastSaveBaseVersion = expectedUpdatedAt;
			lastSavedVersion = updated.updated_at;
			lastSaveBaseHash = expectedContentHash;
			lastSavedHash = updated.contentHash;
			lastContentHash = updated.contentHash;
			lastUpdatedAt = Number(updated.updated_at ?? Date.now() / 1000);
			const isLatestRevision = snapshot.revision === localRevision;
			dirty = !isLatestRevision;
			saveFailed = false;
			retryCount = 0;
			exportedPath = snapshot.exportedPath;
			exportedRuntime = snapshot.exportedRuntime;
			(artifactContents as any).update((items: any[] | null) =>
				(items ?? []).map((item) =>
					item?.previewId === artifact.previewId
						? isLatestRevision
							? {
									...item,
									title: snapshot.title,
									entrypoint: snapshot.entrypoint,
									files: snapshot.files,
									content: snapshot.files[snapshot.entrypoint]?.content ?? '',
									updatedAt: lastUpdatedAt,
									contentHash: lastContentHash,
									exportedPath: snapshot.exportedPath,
									exportedRuntime: snapshot.exportedRuntime
								}
							: { ...item, updatedAt: lastUpdatedAt, contentHash: lastContentHash }
						: item
				)
			);
			if (snapshot.notifyExport) toast.success($i18n.t('Saved to Files'));
		} catch (error: any) {
			dirty = true;
			saveFailed = true;
			if (error?.status === 409) {
				try {
					const document = await selectTransientWebPreview(
						localStorage.token,
						chatId,
						artifact.previewId
					);
					title = document.title;
					entrypoint = document.entrypoint;
					files = structuredClone(document.files);
					selectedPath = files[selectedPath] ? selectedPath : entrypoint;
					lastUpdatedAt = Number(document.updated_at ?? lastUpdatedAt);
					lastContentHash = document.contentHash;
					exportedPath = document.exported_path ?? '';
					exportedRuntime = document.exported_runtime ?? '';
					dirty = false;
					lastSaveBaseVersion = lastUpdatedAt;
					lastSavedVersion = lastUpdatedAt;
					lastSaveBaseHash = lastContentHash;
					lastSavedHash = lastContentHash;
					(artifactContents as any).update((items: any[] | null) =>
						(items ?? []).map((item) =>
							item?.previewId === artifact.previewId
								? {
										...mergeLocalWebPreviewDraft(item, {
											title,
											entrypoint,
											files: structuredClone(files)
										}),
										updatedAt: lastUpdatedAt,
										contentHash: lastContentHash,
										exportedPath,
										exportedRuntime
									}
								: item
						)
					);
					saveFailed = false;
				} catch {
					// Keep the conflict visible when canonical refresh also fails.
				}
				toast.warning($i18n.t('Preview changed elsewhere. The latest version was loaded.'));
				return;
			}
			if (retryCount < 1) {
				retryCount += 1;
				setTimeout(() => {
					if (snapshot.revision === localRevision) previewSaveQueue.enqueue(snapshot);
				}, 1500);
			}
		} finally {
			saving = false;
		}
	};
	const previewSaveQueue = createSerializedSaveQueue(saveSnapshot);

	const queuePreviewSave = () => {
		dirty = true;
		localRevision += 1;
		updateSharedDraft();
		previewSaveQueue.enqueue(buildSaveSnapshot());
	};

	const setSelectedContent = (content: string) => {
		files = { ...files, [selectedPath]: { ...selectedFile, content } };
		queuePreviewSave();
	};

	const showPreview = () => {
		mode = 'preview';
		reloadKey += 1;
	};

	const projectSlug = () =>
		(title || 'web-preview')
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-|-$/g, '') || 'web-preview';

	const sendWorkerMessage = (message: any) => {
		let worker = $pyodideWorker;
		if (!worker) {
			worker = createPyodideWorker();
			pyodideWorker.set(worker);
		}
		const id = `preview-export-${++workerRequestId}`;
		return new Promise<any>((resolve, reject) => {
			const handler = (event: MessageEvent) => {
				if (event.data?.id !== id) return;
				clearTimeout(timeout);
				worker?.removeEventListener('message', handler);
				resolve(event.data);
			};
			const timeout = setTimeout(() => {
				worker?.removeEventListener('message', handler);
				reject(new Error('Pyodide timed out'));
			}, 30000);
			worker?.addEventListener('message', handler);
			worker?.postMessage({ ...message, id });
		});
	};

	const exportToTerminal = async () => {
		if (!runtimeTerminal) throw new Error('Terminal unavailable');
		const cwd = await getCwd(runtimeTerminal.url, localStorage.token, chatId);
		if (!cwd) throw new Error('Terminal unavailable');
		const root = (cwd.root?.path || cwd.cwd || '/workspace').replace(/\/$/, '');
		const base = `${root}/previews/${projectSlug()}`;
		const directories = new Set([`${root}/previews`, base]);
		for (const path of Object.keys(files)) {
			const parts = path.split('/').slice(0, -1);
			let current = base;
			for (const part of parts) {
				current += `/${part}`;
				directories.add(current);
			}
		}
		for (const directory of directories) {
			await createDirectory(runtimeTerminal.url, localStorage.token, directory, chatId);
		}
		for (const [path, file] of Object.entries(files)) {
			const segments = path.split('/');
			const filename = segments.pop() ?? path;
			const directory = segments.length ? `${base}/${segments.join('/')}` : base;
			const result = await uploadToTerminal(
				runtimeTerminal.url,
				localStorage.token,
				directory,
				new File([file.content], filename, { type: file.mime }),
				chatId
			);
			if (!result) throw new Error(`Failed to save ${path}`);
		}
		return base;
	};

	const exportToPyodide = async () => {
		const base = `/mnt/uploads/previews/${projectSlug()}`;
		await sendWorkerMessage({ type: 'fs:mkdir', path: '/mnt/uploads/previews' });
		await sendWorkerMessage({ type: 'fs:mkdir', path: base });
		const directories = new Set<string>();
		for (const path of Object.keys(files)) {
			const parts = path.split('/').slice(0, -1);
			let current = base;
			for (const part of parts) {
				current += `/${part}`;
				directories.add(current);
			}
		}
		for (const directory of directories)
			await sendWorkerMessage({ type: 'fs:mkdir', path: directory });
		for (const [path, file] of Object.entries(files)) {
			const segments = path.split('/');
			const name = segments.pop() ?? path;
			const dir = segments.length ? `${base}/${segments.join('/')}` : base;
			const data = new TextEncoder().encode(file.content).buffer;
			await sendWorkerMessage({ type: 'fs:upload', dir, files: [{ name, data }] });
		}
		return base;
	};

	const exportToFiles = async () => {
		if (!filesAvailable || exporting) return;
		exporting = true;
		try {
			const runtime = workspaceRuntime.kind;
			const path = runtime === 'terminal' ? await exportToTerminal() : await exportToPyodide();
			previewSaveQueue.enqueue(buildSaveSnapshot({ path, runtime }));
			await previewSaveQueue.flush();
		} catch {
			toast.error($i18n.t('Files are currently unavailable'));
		} finally {
			exporting = false;
		}
	};

	const download = async () => {
		const saveBlob = (blob: Blob, filename: string) => {
			const url = URL.createObjectURL(blob);
			const anchor = document.createElement('a');
			anchor.href = url;
			anchor.download = filename;
			anchor.click();
			URL.revokeObjectURL(url);
		};
		if (Object.keys(files).length === 1) {
			const [path, file] = Object.entries(files)[0];
			saveBlob(
				new Blob([file.content], { type: file.mime }),
				path.split('/').at(-1) ?? 'preview.html'
			);
			return;
		}
		const zip = new JSZip();
		for (const [path, file] of Object.entries(files)) zip.file(path, file.content);
		saveBlob(await zip.generateAsync({ type: 'blob' }), `${projectSlug()}.zip`);
	};

	onMount(() => {
		unregisterSaveBarrier = registerWorkspaceSaveBarrier(
			{ kind: 'web_preview', id: artifact.previewId },
			async () => {
				await previewSaveQueue.flush();
				return !saveFailed;
			}
		);
	});

	onDestroy(() => {
		void previewSaveQueue.flush().finally(unregisterSaveBarrier);
	});
</script>

<div
	class="flex h-full min-h-0 flex-col bg-white text-gray-900 dark:bg-gray-950 dark:text-gray-100"
>
	<div
		class="flex h-12 shrink-0 items-center gap-2 border-b border-gray-100 px-3 dark:border-gray-800"
	>
		<input
			class="min-w-0 flex-1 bg-transparent text-sm font-medium outline-none placeholder:text-gray-400"
			value={title}
			on:input={(event) => {
				title = (event.currentTarget as HTMLInputElement).value;
				queuePreviewSave();
			}}
			aria-label={$i18n.t('Preview title')}
		/>
		<span class="shrink-0 text-[11px] text-gray-400 dark:text-gray-500">
			{saveFailed && !saving
				? $i18n.t('Not saved')
				: dirty || saving
					? $i18n.t('Saving...')
					: $i18n.t('Saved')}
		</span>
		<div class="flex items-center rounded-md bg-gray-100 p-0.5 dark:bg-gray-900">
			<button
				type="button"
				class="flex h-7 items-center gap-1.5 rounded px-2 text-xs {mode === 'preview'
					? 'bg-white text-gray-900 shadow-sm dark:bg-gray-800 dark:text-white'
					: 'text-gray-500 dark:text-gray-400'}"
				on:click={showPreview}><Eye className="size-3.5" /> {$i18n.t('Preview')}</button
			>
			<button
				type="button"
				class="flex h-7 items-center gap-1.5 rounded px-2 text-xs {mode === 'code'
					? 'bg-white text-gray-900 shadow-sm dark:bg-gray-800 dark:text-white'
					: 'text-gray-500 dark:text-gray-400'}"
				on:click={() => (mode = 'code')}
				><CodeBracket className="size-3.5" /> {$i18n.t('Code')}</button
			>
		</div>
		<Tooltip content={$i18n.t('Reload')}>
			<button
				class="flex size-8 items-center justify-center rounded-md hover:bg-gray-100 dark:hover:bg-gray-900"
				on:click={() => (reloadKey += 1)}
			>
				<Refresh className="size-4" />
			</button>
		</Tooltip>
		{#if filesAvailable}
			<Tooltip
				content={exportedPath ? $i18n.t('Apply changes to Files') : $i18n.t('Save to Files')}
			>
				<button
					disabled={exporting}
					class="flex size-8 items-center justify-center rounded-md hover:bg-gray-100 disabled:opacity-40 dark:hover:bg-gray-900"
					on:click={exportToFiles}
				>
					<Folder className="size-4" />
				</button>
			</Tooltip>
		{/if}
		<Tooltip content={$i18n.t('Download')}>
			<button
				class="flex size-8 items-center justify-center rounded-md hover:bg-gray-100 dark:hover:bg-gray-900"
				on:click={download}
			>
				<Download className="size-4" />
			</button>
		</Tooltip>
	</div>

	{#if mode === 'preview'}
		{#if previewError}
			<div class="flex min-h-0 flex-1 items-center justify-center p-8 text-center">
				<div>
					<div class="text-sm font-medium">{$i18n.t('Preview unavailable')}</div>
					<div class="mt-1 text-xs text-gray-500 dark:text-gray-400">{previewError}</div>
				</div>
			</div>
		{:else}
			{#key reloadKey}
				<iframe
					{title}
					srcdoc={injectCsp(previewHtml, iframeCsp)}
					class="h-full min-h-0 w-full border-0 bg-white"
					sandbox={buildWebPreviewSandbox({
						allowForms: sandboxAllowForms,
						allowSameOrigin: sandboxAllowSameOrigin
					})}
				></iframe>
			{/key}
		{/if}
	{:else}
		<div class="flex min-h-0 flex-1">
			<nav
				class="w-44 shrink-0 overflow-y-auto border-r border-gray-100 p-2 dark:border-gray-800"
				aria-label={$i18n.t('Preview files')}
			>
				{#each Object.keys(files) as path}
					<button
						type="button"
						class="mb-0.5 block w-full truncate rounded px-2 py-1.5 text-left text-xs {selectedPath ===
						path
							? 'bg-gray-100 text-gray-900 dark:bg-gray-900 dark:text-white'
							: 'text-gray-500 hover:bg-gray-50 dark:text-gray-400 dark:hover:bg-gray-900/60'}"
						on:click={() => (selectedPath = path)}>{path}</button
					>
				{/each}
			</nav>
			<div class="min-w-0 flex-1">
				<FileCodeEditor
					value={selectedFile?.content ?? ''}
					filePath={selectedPath}
					onChange={setSelectedContent}
					onSave={async (content) => setSelectedContent(content)}
				/>
			</div>
		</div>
	{/if}
</div>
