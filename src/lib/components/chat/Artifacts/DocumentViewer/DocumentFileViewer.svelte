<script lang="ts">
	import { getContext, onMount } from 'svelte';
	import type { Writable } from 'svelte/store';
	import type { i18n as i18nType } from 'i18next';
	import { createPyodideWorker } from '$lib/pyodide/createPyodideWorker';
	import { pyodideWorker, workspaceActiveFile, workspaceFileUpdate } from '$lib/stores';
	import PDFViewer from '$lib/components/common/PDFViewer.svelte';
	import OfficeDocumentPreview from '$lib/components/common/OfficeDocumentPreview.svelte';
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
	export let format: WorkspaceDocumentFormat;
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
	let mounted = false;
	let loadGeneration = 0;
	let loadAbortController: AbortController | null = null;
	let refreshTimer: number | null = null;
	let copiedPdfSource: ArrayBuffer | null = null;
	let pdfData: ArrayBuffer | null = null;
	let pendingPyodideRefresh = false;
	let restoringAfterRenderFailure = false;
	$: if (format === 'pdf' && candidateData !== copiedPdfSource) {
		copiedPdfSource = candidateData;
		pdfData = candidateData?.slice(0) ?? null;
	}

	const mimeTypes: Record<WorkspaceDocumentFormat, string> = {
		pdf: 'application/pdf',
		docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
		pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
		xls: 'application/vnd.ms-excel',
		xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
	};
	const maxDocumentBytes: Record<WorkspaceDocumentFormat, number> = {
		pdf: 64 * 1024 * 1024,
		docx: 48 * 1024 * 1024,
		pptx: 64 * 1024 * 1024,
		xls: 48 * 1024 * 1024,
		xlsx: 48 * 1024 * 1024
	};

	const readPyodideFile = (signal: AbortSignal): Promise<ArrayBuffer> => {
		let worker = $pyodideWorker;
		if (!worker) {
			worker = createPyodideWorker();
			pyodideWorker.set(worker);
		}
		return readPyodideWorkerFile(worker, path, maxDocumentBytes[format], signal);
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
		loadAbortController?.abort();
		const abortController = new AbortController();
		loadAbortController = abortController;
		if (displayedData && isRefresh) refreshing = true;
		else loading = true;

		try {
			const nextData = await readPyodideFile(abortController.signal);
			if (generation !== loadGeneration) return;
			assertDocumentSize(nextData, maxDocumentBytes[format]);
			candidateData = nextData;
			candidateGeneration = generation;
			error = '';
		} catch (cause) {
			if (generation !== loadGeneration || abortController.signal.aborted) return;
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
		// Its acknowledgement still maps back to the original candidate, which remains
		// the only buffer that can become available for download.
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

	const download = () => {
		if (!displayedData) return;
		const url = URL.createObjectURL(new Blob([displayedData], { type: mimeTypes[format] }));
		const anchor = document.createElement('a');
		anchor.href = url;
		anchor.download = path.split('/').pop() ?? `document.${format}`;
		anchor.style.display = 'none';
		document.body.appendChild(anchor);
		anchor.click();
		anchor.remove();
		window.setTimeout(() => URL.revokeObjectURL(url), 0);
	};

	const toggleFullscreen = async () => {
		if (!root) return;
		if (document.fullscreenElement === root) await document.exitFullscreen();
		else await root.requestFullscreen();
	};

	const refreshPyodideFile = (event: Event) => {
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
			$workspaceActiveFile?.path === path
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
		const action = getWorkspaceFileUpdateAction(update, path, $workspaceActiveFile?.path === path);
		if (action === 'deleted') {
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
		const unsubscribeUpdate = workspaceFileUpdate.subscribe((update) => {
			handleWorkspaceFileUpdate(update);
		});
		window.addEventListener('pyodide:files', refreshPyodideFile);
		void loadFile();

		return () => {
			mounted = false;
			loadGeneration += 1;
			loadAbortController?.abort();
			if (refreshTimer) window.clearTimeout(refreshTimer);
			unsubscribeUpdate();
			window.removeEventListener('pyodide:files', refreshPyodideFile);
		};
	});

	$: if (mounted && pendingPyodideRefresh && $workspaceActiveFile?.path === path) {
		pendingPyodideRefresh = false;
		scheduleLoad(true);
	}
</script>

<div
	bind:this={root}
	class="document-viewer relative h-full min-h-0 overflow-hidden bg-white dark:bg-gray-900"
	data-testid="document-file-viewer"
	data-document-path={path}
	data-rendered-generation={displayedGeneration || undefined}
	aria-busy={loading || refreshing}
>
	{#if displayedData}
		<div
			class="absolute right-3 top-3 z-30 flex items-center gap-1 rounded-xl border border-gray-200/80 bg-white/90 p-1 shadow-sm backdrop-blur-md dark:border-gray-700/80 dark:bg-gray-850/90"
		>
			<Tooltip content={$i18n.t('Download displayed version')}>
				<button
					type="button"
					class="flex size-8 items-center justify-center rounded-lg text-gray-500 transition hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white"
					aria-label={$i18n.t('Download displayed version')}
					on:click={download}
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
		</div>
	{/if}

	{#if format === 'pdf' && candidateData}
		<PDFViewer
			data={pdfData}
			{targetPage}
			on:preview-rendered={handlePreviewRendered}
			on:preview-failed={handlePreviewFailed}
			className="w-full h-full bg-[#f5f4f1] dark:bg-[#171719] px-3 pt-12 pb-16 sm:px-6"
		/>
	{:else if candidateData}
		<OfficeDocumentPreview
			data={candidateData}
			format={format as Exclude<WorkspaceDocumentFormat, 'pdf'>}
			{targetPage}
			on:preview-rendered={handlePreviewRendered}
			on:preview-failed={handlePreviewFailed}
		/>
	{/if}

	{#if loading && !displayedData}
		<div class="absolute inset-0 flex items-center justify-center">
			<span class="sr-only" role="status">{$i18n.t('Loading')}</span>
			<Spinner className="size-5" />
		</div>
	{:else if refreshing}
		<div
			class="pointer-events-none absolute left-3 top-3 z-30 rounded-full bg-white/90 p-2 shadow-sm dark:bg-gray-850/90"
		>
			<Spinner className="size-3.5" />
		</div>
	{:else if error && !displayedData}
		<div
			role="alert"
			class="absolute inset-0 flex items-center justify-center p-8 text-center text-sm text-gray-500 dark:text-gray-400"
		>
			<div class="space-y-3">
				<div>{error}</div>
				<button
					type="button"
					class="rounded-lg bg-gray-900 px-3 py-1.5 text-sm font-medium text-white dark:bg-gray-100 dark:text-gray-900"
					on:click={() => scheduleLoad(true)}
				>
					{$i18n.t('Try again')}
				</button>
			</div>
		</div>
	{:else if error}
		<div
			role="status"
			class="absolute bottom-4 left-1/2 z-30 flex -translate-x-1/2 items-center gap-2 rounded-full bg-red-50 px-3 py-1.5 text-xs text-red-700 shadow-sm dark:bg-red-950/90 dark:text-red-200"
		>
			<span>{error}</span>
			<button type="button" class="font-semibold underline" on:click={() => scheduleLoad(true)}>
				{$i18n.t('Try again')}
			</button>
		</div>
	{/if}
</div>

<style>
	.document-viewer:fullscreen {
		background: white;
	}

	:global(.dark) .document-viewer:fullscreen {
		background: #111113;
	}
</style>
