<script lang="ts">
	import { getContext, onMount } from 'svelte';
	import { createPyodideWorker } from '$lib/pyodide/createPyodideWorker';
	import {
		pyodideWorker,
		terminalServers,
		workspaceActiveFile,
		workspaceFileUpdate
	} from '$lib/stores';
	import { downloadFileBlob } from '$lib/apis/terminal';
	import PDFViewer from '$lib/components/common/PDFViewer.svelte';
	import Spinner from '$lib/components/common/Spinner.svelte';
	import Download from '$lib/components/icons/Download.svelte';
	import ArrowsPointingOut from '$lib/components/icons/ArrowsPointingOut.svelte';
	import Tooltip from '$lib/components/common/Tooltip.svelte';
	import WordDocumentViewer from './WordDocumentViewer.svelte';
	import PowerPointDocumentViewer from './PowerPointDocumentViewer.svelte';
	import {
		getWorkspaceFileRefreshAction,
		type WorkspaceDocumentFormat,
		type WorkspaceRuntime
	} from '../workspace';
	const i18n = getContext('i18n');

	export let path: string;
	export let format: WorkspaceDocumentFormat;
	export let runtime: WorkspaceRuntime;
	export let chatId: string | null = null;

	let root: HTMLDivElement;
	let data: ArrayBuffer | null = null;
	let loading = true;
	let refreshing = false;
	let error = '';
	let mounted = false;
	let loadGeneration = 0;
	let copiedPdfSource: ArrayBuffer | null = null;
	let pdfData: ArrayBuffer | null = null;
	let pendingPyodideRefresh = false;
	$: if (format === 'pdf' && data !== copiedPdfSource) {
		copiedPdfSource = data;
		pdfData = data?.slice(0) ?? null;
	}

	const mimeTypes: Record<WorkspaceDocumentFormat, string> = {
		pdf: 'application/pdf',
		docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
		pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
	};
	const maxDocumentBytes: Record<WorkspaceDocumentFormat, number> = {
		pdf: 64 * 1024 * 1024,
		docx: 48 * 1024 * 1024,
		pptx: 64 * 1024 * 1024
	};

	const readPyodideFile = (): Promise<ArrayBuffer> => {
		let worker = $pyodideWorker;
		if (!worker) {
			worker = createPyodideWorker();
			pyodideWorker.set(worker);
		}
		const activeWorker = worker;
		const id = `document-viewer-${crypto.randomUUID()}`;
		return new Promise((resolve, reject) => {
			const timeout = window.setTimeout(() => {
				activeWorker.removeEventListener('message', handler);
				reject(new Error('File request timed out'));
			}, 30000);
			const handler = (event: MessageEvent) => {
				if (event.data?.id !== id) return;
				window.clearTimeout(timeout);
				activeWorker.removeEventListener('message', handler);
				if (event.data?.error) {
					reject(new Error(event.data.error));
					return;
				}
				const bytes = event.data?.data;
				if (bytes instanceof ArrayBuffer) resolve(bytes);
				else if (ArrayBuffer.isView(bytes)) {
					resolve(
						bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
					);
				} else reject(new Error('File data was not returned'));
			};
			activeWorker.addEventListener('message', handler);
			activeWorker.postMessage({
				type: 'fs:read',
				path,
				id,
				maxBytes: maxDocumentBytes[format]
			});
		});
	};

	const readTerminalFile = async () => {
		const terminal = ($terminalServers ?? []).find((item) => item.id === runtime.terminalId);
		if (!terminal?.url) throw new Error('Terminal file source is unavailable');
		const result = await downloadFileBlob(
			terminal.url,
			localStorage.token,
			path,
			chatId ?? undefined,
			maxDocumentBytes[format]
		);
		if (!result) throw new Error('File download failed');
		return result.blob.arrayBuffer();
	};

	const loadFile = async (isRefresh = false) => {
		if (!mounted || runtime.kind === 'none') return;
		const generation = ++loadGeneration;
		if (data && isRefresh) refreshing = true;
		else loading = true;
		error = '';

		try {
			const nextData =
				runtime.kind === 'terminal' ? await readTerminalFile() : await readPyodideFile();
			if (generation !== loadGeneration) return;
			if (nextData.byteLength > maxDocumentBytes[format]) {
				throw new Error('Document exceeds the viewer size limit');
			}
			data = nextData;
		} catch (cause) {
			console.error('Document file load failed:', cause);
			if (!data) error = $i18n.t('This document could not be opened.');
		} finally {
			if (generation === loadGeneration) {
				loading = false;
				refreshing = false;
			}
		}
	};

	const download = () => {
		if (!data) return;
		const url = URL.createObjectURL(new Blob([data], { type: mimeTypes[format] }));
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
		if (runtime.kind !== 'pyodide') return;
		const changedPaths = (event as CustomEvent<{ paths?: string[] }>).detail?.paths;
		const action = getWorkspaceFileRefreshAction(
			changedPaths,
			path,
			$workspaceActiveFile?.path === path
		);
		if (action === 'refresh') void loadFile(true);
		else if (action === 'defer') pendingPyodideRefresh = true;
	};

	onMount(() => {
		mounted = true;
		const unsubscribeUpdate = workspaceFileUpdate.subscribe((update) => {
			if (update?.path === path) void loadFile(true);
		});
		window.addEventListener('pyodide:files', refreshPyodideFile);
		void loadFile();

		return () => {
			mounted = false;
			loadGeneration += 1;
			unsubscribeUpdate();
			window.removeEventListener('pyodide:files', refreshPyodideFile);
		};
	});

	$: if (
		mounted &&
		runtime.kind === 'pyodide' &&
		pendingPyodideRefresh &&
		$workspaceActiveFile?.path === path
	) {
		pendingPyodideRefresh = false;
		void loadFile(true);
	}
</script>

<div
	bind:this={root}
	class="document-viewer relative h-full min-h-0 overflow-hidden bg-white dark:bg-gray-900"
	data-testid="document-file-viewer"
	data-document-path={path}
	aria-busy={loading || refreshing}
>
	{#if data}
		<div
			class="absolute right-3 top-3 z-30 flex items-center gap-1 rounded-xl border border-gray-200/80 bg-white/90 p-1 shadow-sm backdrop-blur-md dark:border-gray-700/80 dark:bg-gray-850/90"
		>
			<Tooltip content={$i18n.t('Download')}>
				<button
					type="button"
					class="flex size-8 items-center justify-center rounded-lg text-gray-500 transition hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white"
					aria-label={$i18n.t('Download')}
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

		{#if format === 'pdf'}
			<PDFViewer
				data={pdfData}
				className="w-full h-full bg-[#f5f4f1] dark:bg-[#171719] px-3 pt-12 pb-16 sm:px-6"
			/>
		{:else if format === 'docx'}
			<WordDocumentViewer {data} />
		{:else if format === 'pptx'}
			<PowerPointDocumentViewer {data} />
		{/if}
	{/if}

	{#if loading && !data}
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
	{:else if error}
		<div
			role="alert"
			class="absolute inset-0 flex items-center justify-center p-8 text-center text-sm text-gray-500 dark:text-gray-400"
		>
			{error}
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
