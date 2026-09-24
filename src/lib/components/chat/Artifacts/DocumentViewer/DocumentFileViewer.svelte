<script lang="ts">
	import { getContext, onMount } from 'svelte';
	import type { Writable } from 'svelte/store';
	import type { i18n as i18nType } from 'i18next';
	import { createPyodideWorker } from '$lib/pyodide/createPyodideWorker';
	import { getFileContentById } from '$lib/apis/files';
	import { WEBUI_API_BASE_URL } from '$lib/constants';
	import { pyodideWorker, workspaceActiveFile, workspaceFileUpdate } from '$lib/stores';
	import PDFViewer from '$lib/components/common/PDFViewer.svelte';
	import OfficeDocumentPreview from '$lib/components/common/OfficeDocumentPreview.svelte';
	import FilePreview from '../../FileNav/FilePreview.svelte';
	import Spinner from '$lib/components/common/Spinner.svelte';
	import Download from '$lib/components/icons/Download.svelte';
	import ArrowsPointingOut from '$lib/components/icons/ArrowsPointingOut.svelte';
	import Tooltip from '$lib/components/common/Tooltip.svelte';
	import {
		assertDocumentSize,
		DOCUMENT_TOO_LARGE_ERROR,
		readPyodideWorkerFile
	} from './pyodideFileRead';
	import {
		getWorkspaceFileRefreshAction,
		getWorkspaceFileUpdateAction,
		type WorkspaceDocumentFormat
	} from '../workspace';
	const i18n: Writable<i18nType> = getContext('i18n');

	export let path: string;
	export let fileId: string | null = null;
	export let format: WorkspaceDocumentFormat | null = null;
	export let targetPage: number | null = null;

	let root: HTMLDivElement;
	// Runtime reads are candidates until the renderer confirms this exact buffer.
	let candidateData: ArrayBuffer | null = null;
	let displayedData: ArrayBuffer | null = null;
	let candidateGeneration = 0;
	let displayedGeneration = 0;
	let loading = true;
	let refreshing = false;
	let error = '';
	let tooLarge = false;
	let downloadError = '';
	let downloadAbortController: AbortController | null = null;
	$: downloading = downloadAbortController !== null;
	let mounted = false;
	let loadGeneration = 0;
	let loadAbortController: AbortController | null = null;
	let refreshTimer: number | null = null;
	let copiedPdfSource: ArrayBuffer | null = null;
	let pdfData: ArrayBuffer | null = null;
	let pendingPyodideRefresh = false;
	let restoringAfterRenderFailure = false;
	let loadedSourceKey = '';
	let fileContent: string | null = null;
	let fileImageUrl: string | null = null;
	let binaryFile = false;
	$: maxBytes = format ? maxDocumentBytes[format] : 16 * 1024 * 1024;
	$: if (format === 'pdf' && candidateData !== copiedPdfSource) {
		copiedPdfSource = candidateData;
		pdfData = candidateData?.slice(0) ?? null;
	}

	const mimeTypes: Record<WorkspaceDocumentFormat, string> = {
		pdf: 'application/pdf',
		docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
		pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
		xls: 'application/vnd.ms-excel',
		xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
		csv: 'text/csv'
	};
	const maxDocumentBytes: Record<WorkspaceDocumentFormat, number> = {
		pdf: 64 * 1024 * 1024,
		docx: 48 * 1024 * 1024,
		pptx: 64 * 1024 * 1024,
		xls: 48 * 1024 * 1024,
		xlsx: 48 * 1024 * 1024,
		csv: 16 * 1024 * 1024
	};

	const readPyodideFile = (signal: AbortSignal, maximumBytes = maxBytes): Promise<ArrayBuffer> => {
		if (fileId) {
			return getFileContentById(fileId).then((data) => {
				if (signal.aborted) throw new DOMException('The operation was aborted.', 'AbortError');
				if (!(data instanceof ArrayBuffer)) throw new Error('missing');
				return data;
			});
		}
		let worker = $pyodideWorker;
		if (!worker) {
			worker = createPyodideWorker();
			pyodideWorker.set(worker);
		}
		return readPyodideWorkerFile(worker, path, maximumBytes, signal);
	};

	const cancelDownload = () => {
		downloadAbortController?.abort();
		downloadAbortController = null;
		downloadError = '';
	};

	const getLoadError = (cause: unknown) => {
		if (cause instanceof Error && cause.message === 'missing') {
			return $i18n.t('This file is no longer available.');
		}
		if (cause instanceof Error && cause.message === 'unavailable') {
			return $i18n.t(
				'The document service is temporarily unavailable. Try again when it reconnects.'
			);
		}
		if (cause instanceof Error && cause.message === DOCUMENT_TOO_LARGE_ERROR) {
			return $i18n.t('This document is too large to display here.');
		}
		return $i18n.t('This document could not be opened.');
	};

	const loadFile = async (isRefresh = false) => {
		if (!mounted) return;
		const generation = ++loadGeneration;
		cancelDownload();
		tooLarge = false;
		loadAbortController?.abort();
		const abortController = new AbortController();
		loadAbortController = abortController;
		if (displayedData && isRefresh) refreshing = true;
		else loading = true;

		try {
			const nextData = await readPyodideFile(abortController.signal);
			if (generation !== loadGeneration) return;
			assertDocumentSize(nextData, maxBytes);
			candidateData = nextData;
			candidateGeneration = generation;
			error = '';
			if (!format) {
				clearFilePreview();
				if (/\.(png|jpe?g|gif|webp|bmp|ico|avif)$/i.test(path)) {
					fileImageUrl = URL.createObjectURL(new Blob([nextData]));
				} else {
					try {
						fileContent = new TextDecoder('utf-8', { fatal: true }).decode(nextData);
						binaryFile = fileContent.includes('\0');
					} catch {
						binaryFile = true;
					}
				}
				displayedData = nextData;
				displayedGeneration = generation;
				loading = false;
				refreshing = false;
			}
		} catch (cause) {
			if (generation !== loadGeneration || abortController.signal.aborted) return;
			tooLarge = cause instanceof Error && cause.message === DOCUMENT_TOO_LARGE_ERROR;
			console.error('Document file load failed:', cause);
			if (cause instanceof Error && cause.message === 'missing') {
				candidateData = null;
				displayedData = null;
				error = getLoadError(cause);
			} else {
				error = displayedData
					? $i18n.t('The latest version could not be loaded. Showing the previous version.')
					: getLoadError(cause);
			}
		} finally {
			if (generation === loadGeneration) {
				if (error) {
					loading = false;
					refreshing = false;
				}
			}
		}
	};

	const scheduleLoad = (isRefresh = true) => {
		if (refreshTimer) window.clearTimeout(refreshTimer);
		refreshTimer = window.setTimeout(() => {
			refreshTimer = null;
			void loadFile(isRefresh);
		}, 120);
	};

	const getRenderedCandidate = (detail: unknown) => {
		const bytes =
			detail && typeof detail === 'object' && 'data' in detail
				? (detail as { data?: ArrayBuffer | Uint8Array | null }).data
				: (detail as ArrayBuffer | Uint8Array | null);
		// PDF.js receives a defensive clone because it may transfer its input buffer.
		// Its acknowledgement maps back to the original candidate used by
		// "Download displayed version", separately from an explicit original-file download.
		return bytes === candidateData || bytes === pdfData ? candidateData : null;
	};

	const handlePreviewRendered = (event: CustomEvent<unknown>) => {
		const renderedCandidate = getRenderedCandidate(event.detail);
		if (!renderedCandidate) return;
		displayedData = renderedCandidate;
		displayedGeneration = candidateGeneration;
		if (restoringAfterRenderFailure) restoringAfterRenderFailure = false;
		else error = '';
		loading = false;
		refreshing = false;
	};

	const handlePreviewFailed = (event: CustomEvent<unknown>) => {
		if (!getRenderedCandidate(event.detail)) return;
		restoringAfterRenderFailure = Boolean(displayedData);
		candidateData = displayedData;
		error = displayedData
			? $i18n.t('The latest update could not be displayed. Showing the previous version.')
			: $i18n.t('This document could not be opened.');
		loading = false;
		refreshing = false;
	};

	const startDownload = (url: string) => {
		const anchor = document.createElement('a');
		anchor.href = url;
		anchor.download = path.split('/').pop() ?? `document.${format}`;
		anchor.style.display = 'none';
		document.body.appendChild(anchor);
		anchor.click();
		anchor.remove();
	};

	const download = (data: ArrayBuffer | null) => {
		if (!data) return;
		const url = URL.createObjectURL(
			new Blob([data], { type: format ? mimeTypes[format] : 'application/octet-stream' })
		);
		startDownload(url);
		window.setTimeout(() => URL.revokeObjectURL(url), 0);
	};

	const downloadOriginal = async () => {
		if (downloadAbortController) return;
		downloadError = '';
		if (fileId) {
			// Let the browser stream saved files without allocating another preview buffer.
			startDownload(
				`${WEBUI_API_BASE_URL}/files/${encodeURIComponent(fileId)}/content?attachment=true`
			);
			return;
		}
		const controller = new AbortController();
		downloadAbortController = controller;
		const sourcePath = path;
		try {
			// Only an explicit download bypasses the preview budget, as in the file browser.
			const data = await readPyodideFile(controller.signal, Number.MAX_SAFE_INTEGER);
			if (!mounted || controller.signal.aborted || path !== sourcePath) return;
			download(data);
		} catch {
			if (!controller.signal.aborted) downloadError = $i18n.t('Download failed');
		} finally {
			if (downloadAbortController === controller) downloadAbortController = null;
		}
	};

	const toggleFullscreen = async () => {
		if (!root) return;
		if (document.fullscreenElement === root) await document.exitFullscreen();
		else await root.requestFullscreen();
	};

	const clearFilePreview = () => {
		if (fileImageUrl) URL.revokeObjectURL(fileImageUrl);
		fileImageUrl = null;
		fileContent = null;
		binaryFile = false;
	};

	const refreshPyodideFile = (event: Event) => {
		if (fileId) return;
		const detail = (
			event as CustomEvent<{
				paths?: string[];
				previousPath?: string;
				kind?: 'changed' | 'deleted' | 'renamed' | 'unknown';
			}>
		).detail;
		const changedPaths = detail?.paths;
		if (detail?.kind === 'deleted' && changedPaths?.includes(path)) {
			handleWorkspaceFileUpdate({ path, kind: 'deleted' });
			return;
		}
		if (detail?.kind === 'renamed' && detail.previousPath === path) {
			handleWorkspaceFileUpdate({
				path: changedPaths?.[0],
				previousPath: detail.previousPath,
				kind: 'renamed'
			});
			return;
		}
		const action = getWorkspaceFileRefreshAction(
			changedPaths,
			path,
			!format || $workspaceActiveFile?.path === path
		);
		if (action === 'refresh') scheduleLoad(true);
		else if (action === 'defer') pendingPyodideRefresh = true;
	};

	const handleWorkspaceFileUpdate = (
		update: {
			path?: string;
			previousPath?: string;
			kind?: 'changed' | 'deleted' | 'renamed' | 'unknown';
		} | null
	) => {
		if (!update) return;
		const action = getWorkspaceFileUpdateAction(
			update,
			path,
			!format || $workspaceActiveFile?.path === path
		);
		if (action === 'deleted') {
			cancelDownload();
			tooLarge = false;
			loadGeneration += 1;
			loadAbortController?.abort();
			candidateData = null;
			displayedData = null;
			candidateGeneration = 0;
			displayedGeneration = 0;
			error = $i18n.t('This file is no longer available.');
			loading = false;
			refreshing = false;
			return;
		}
		if (action === 'renamed') {
			cancelDownload();
			tooLarge = false;
			loadGeneration += 1;
			loadAbortController?.abort();
			candidateData = null;
			displayedData = null;
			candidateGeneration = 0;
			displayedGeneration = 0;
			error = $i18n.t('This file was moved. Open it again from Files.');
			loading = false;
			refreshing = false;
			return;
		}
		if (action === 'refresh') scheduleLoad(true);
		else if (action === 'defer') pendingPyodideRefresh = true;
	};

	onMount(() => {
		mounted = true;
		loadedSourceKey = `${path}:${fileId ?? 'runtime'}`;
		const unsubscribeUpdate = workspaceFileUpdate.subscribe((update) => {
			handleWorkspaceFileUpdate(update);
		});
		window.addEventListener('pyodide:files', refreshPyodideFile);
		void loadFile();

		return () => {
			mounted = false;
			cancelDownload();
			loadGeneration += 1;
			loadAbortController?.abort();
			if (refreshTimer) window.clearTimeout(refreshTimer);
			unsubscribeUpdate();
			window.removeEventListener('pyodide:files', refreshPyodideFile);
			clearFilePreview();
		};
	});

	$: if (mounted && pendingPyodideRefresh && $workspaceActiveFile?.path === path) {
		pendingPyodideRefresh = false;
		scheduleLoad(true);
	}

	$: if (mounted && `${path}:${fileId ?? 'runtime'}` !== loadedSourceKey) {
		cancelDownload();
		tooLarge = false;
		loadedSourceKey = `${path}:${fileId ?? 'runtime'}`;
		scheduleLoad(Boolean(displayedData));
	}
</script>

<div
	bind:this={root}
	class="document-viewer relative flex h-full min-h-0 flex-col overflow-hidden bg-white text-gray-800 dark:bg-gray-850 dark:text-gray-200"
	data-testid="document-file-viewer"
	data-document-path={path}
	data-rendered-generation={displayedGeneration || undefined}
	aria-busy={loading || refreshing}
>
	{#if displayedData || refreshing}
		<div
			role="group"
			aria-label={$i18n.t('Document actions')}
			class="absolute right-3 top-3 z-20 flex items-center gap-1 rounded-lg border border-gray-200/80 bg-white/95 p-1 shadow-sm backdrop-blur-sm dark:border-gray-700/80 dark:bg-gray-850/95"
		>
			{#if refreshing}
				<span class="mr-auto px-2" role="status" aria-label={$i18n.t('Loading')}>
					<Spinner className="size-3.5" />
				</span>
			{/if}
			{#if displayedData}
				<Tooltip content={$i18n.t('Download displayed version')}>
					<button
						type="button"
						class="flex size-8 items-center justify-center rounded-lg text-gray-500 transition hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white"
						aria-label={$i18n.t('Download displayed version')}
						on:click={() => download(displayedData)}
					>
						<Download className="size-4" />
					</button>
				</Tooltip>
				<Tooltip content={$i18n.t('Fullscreen')}>
					<button
						type="button"
						class="flex size-8 items-center justify-center rounded-lg text-gray-500 transition hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white"
						aria-label={$i18n.t('Fullscreen')}
						on:click={() => void toggleFullscreen()}
					>
						<ArrowsPointingOut className="size-4" />
					</button>
				</Tooltip>
			{/if}
		</div>
	{/if}

	<div
		class="relative min-h-0 flex-1 overflow-hidden bg-gray-50 dark:bg-gray-850"
		data-testid="document-viewer-content"
	>
		{#if format === 'pdf' && candidateData}
			<PDFViewer
				data={pdfData}
				{targetPage}
				on:preview-rendered={handlePreviewRendered}
				on:preview-failed={handlePreviewFailed}
				className="w-full h-full px-3 pt-4 pb-16 sm:px-6"
			/>
		{:else if candidateData && format}
			<OfficeDocumentPreview
				data={candidateData}
				format={format as Exclude<WorkspaceDocumentFormat, 'pdf'>}
				{targetPage}
				on:preview-rendered={handlePreviewRendered}
				on:preview-failed={handlePreviewFailed}
			/>
		{:else if candidateData && binaryFile}
			<div
				class="flex h-full items-center justify-center p-8 text-center text-sm text-gray-500 dark:text-gray-400"
			>
				{$i18n.t('Preview not available')}
			</div>
		{:else if candidateData}
			<FilePreview selectedFile={path} {fileContent} {fileImageUrl} readOnly />
		{/if}

		{#if loading && !displayedData}
			<div class="absolute inset-0 flex items-center justify-center">
				<span class="sr-only" role="status">{$i18n.t('Loading')}</span>
				<Spinner className="size-5" />
			</div>
		{:else if error && !displayedData}
			<div
				role="alert"
				class="absolute inset-0 flex items-center justify-center p-8 text-center text-sm text-gray-500 dark:text-gray-400"
			>
				<div class="space-y-3">
					<div>{error}</div>
					{#if downloadError}<div>{downloadError}</div>{/if}
					<button
						type="button"
						class="inline-flex items-center gap-2 rounded-lg bg-gray-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-gray-100 dark:text-gray-900"
						disabled={downloading}
						aria-busy={downloading}
						on:click={() => (tooLarge ? downloadOriginal() : scheduleLoad(true))}
					>
						{#if downloading}<Spinner className="size-4" />{:else if tooLarge}<Download
								className="size-4"
							/>{/if}
						{$i18n.t(tooLarge ? 'Download' : 'Try again')}
					</button>
				</div>
			</div>
		{:else if error}
			<div
				role="status"
				class="absolute bottom-4 left-1/2 z-30 flex -translate-x-1/2 items-center gap-2 rounded-full bg-red-50 px-3 py-1.5 text-xs text-red-700 shadow-sm dark:bg-red-950/90 dark:text-red-200"
			>
				<span
					>{error}{#if downloadError}<br />{downloadError}{/if}</span
				>
				<button
					type="button"
					class="inline-flex shrink-0 items-center gap-1 font-semibold underline disabled:opacity-50"
					disabled={downloading}
					aria-busy={downloading}
					on:click={() => (tooLarge ? downloadOriginal() : scheduleLoad(true))}
				>
					{#if downloading}<Spinner className="size-3.5" />{:else if tooLarge}<Download
							className="size-3.5"
						/>{/if}
					{$i18n.t(tooLarge ? 'Download' : 'Try again')}
				</button>
			</div>
		{/if}
	</div>
</div>

<style>
	.document-viewer :global(*::-webkit-scrollbar-corner) {
		background: transparent;
	}

	.document-viewer :global(.cm-editor),
	.document-viewer :global(.cm-gutters) {
		background: transparent;
	}
</style>
