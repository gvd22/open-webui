<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url';
	import panzoom, { type PanZoom } from 'panzoom';
	import Spinner from './Spinner.svelte';

	export let url: string | null = null;
	export let data: ArrayBuffer | Uint8Array | null = null;
	export let className = 'w-full h-[70vh]';

	let outerContainer: HTMLDivElement;
	let sceneElement: HTMLDivElement;
	let loading = true;
	let error = '';
	let pdfDoc: any = null;
	let pzInstance: PanZoom | null = null;
	let zoomLevel = 1;
	let rerenderTimer: ReturnType<typeof setTimeout> | null = null;
	let lastRenderedZoom = 1;
	let mounted = false;
	let loadedData: ArrayBuffer | Uint8Array | null = null;
	let loadedUrl: string | null = null;
	let loadGeneration = 0;

	let pageObserver: IntersectionObserver | null = null;
	const pageTextLayers = new Map<HTMLElement, any>();
	const pageRenderTasks = new Map<HTMLElement, any>();
	const pageRenderTokens = new WeakMap<HTMLElement, symbol>();

	const releasePage = (wrapper: HTMLElement) => {
		pageRenderTokens.delete(wrapper);
		pageRenderTasks.get(wrapper)?.cancel?.();
		pageRenderTasks.delete(wrapper);
		try {
			pageTextLayers.get(wrapper)?.cancel?.();
		} catch (_) {}
		pageTextLayers.delete(wrapper);
		wrapper.replaceChildren();
		wrapper.dataset.renderState = 'idle';
	};

	const releaseAllPages = () => {
		pageObserver?.disconnect();
		pageObserver = null;
		for (const wrapper of sceneElement?.querySelectorAll<HTMLElement>('.pdf-page-wrapper') ?? []) {
			releasePage(wrapper);
		}
	};

	const initPanzoom = () => {
		if (pzInstance) {
			pzInstance.dispose();
		}
		if (sceneElement) {
			pzInstance = panzoom(sceneElement, {
				bounds: true,
				boundsPadding: 0.1,
				minZoom: 0.5,
				maxZoom: 4,
				zoomSpeed: 0.065,
				beforeWheel: (e) => {
					// Only zoom on pinch (ctrlKey / metaKey); let normal scroll pass through
					if (!e.ctrlKey && !e.metaKey) {
						return true; // returning true cancels the panzoom wheel handling
					}
					return false;
				},
				beforeMouseDown: (e) => {
					// Only allow drag-to-pan when zoomed in (not at default scale)
					const transform = pzInstance?.getTransform();
					if (transform && Math.abs(transform.scale - 1) < 0.01) {
						return true; // cancel panzoom mouse handling at 1x — allow text selection / normal interaction
					}
					return false;
				}
			});
			pzInstance.on('zoom', () => {
				zoomLevel = pzInstance?.getTransform()?.scale ?? 1;
				// Debounced re-render at new resolution so text stays crisp
				if (rerenderTimer) clearTimeout(rerenderTimer);
				rerenderTimer = setTimeout(() => {
					if (Math.abs(zoomLevel - lastRenderedZoom) > 0.05) {
						rerenderPages(zoomLevel);
					}
				}, 300);
			});
		}
	};

	const zoomIn = () => {
		if (!pzInstance || !outerContainer) return;
		const cx = outerContainer.clientWidth / 2;
		const cy = outerContainer.clientHeight / 2;
		pzInstance.zoomTo(cx, cy, 1.25); // +25%
		zoomLevel = pzInstance.getTransform().scale;
	};

	const zoomOut = () => {
		if (!pzInstance || !outerContainer) return;
		const cx = outerContainer.clientWidth / 2;
		const cy = outerContainer.clientHeight / 2;
		pzInstance.zoomTo(cx, cy, 0.8); // -20% (inverse of 1.25)
		zoomLevel = pzInstance.getTransform().scale;
	};

	export const resetView = () => {
		if (pzInstance) {
			pzInstance.moveTo(0, 0);
			pzInstance.zoomAbs(0, 0, 1);
			zoomLevel = 1;
			rerenderPages(1);
		}
	};

	const renderPage = async (wrapper: HTMLElement) => {
		if (!pdfDoc || wrapper.dataset.renderState !== 'idle') return;
		const documentToRender = pdfDoc;
		const pageNumber = Number(wrapper.dataset.pageNumber);
		const renderToken = Symbol(`pdf-page-${pageNumber}`);
		pageRenderTokens.set(wrapper, renderToken);
		wrapper.dataset.renderState = 'loading';
		const pdfjs = await import('pdfjs-dist');
		if (pageRenderTokens.get(wrapper) !== renderToken) return;
		const dpr = window.devicePixelRatio || 1;
		const containerWidth = Math.max(320, Math.min((outerContainer?.clientWidth || 800) - 24, 1024));

		let renderTask: any = null;
		try {
			const page = await documentToRender.getPage(pageNumber);
			if (documentToRender !== pdfDoc || pageRenderTokens.get(wrapper) !== renderToken) return;
			const viewport = page.getViewport({ scale: 1 });
			const cssScale = containerWidth / viewport.width;
			let renderScale = cssScale * zoomLevel * dpr;
			const estimatedPixels = viewport.width * renderScale * (viewport.height * renderScale);
			const maxCanvasPixels = 24_000_000;
			if (estimatedPixels > maxCanvasPixels) {
				renderScale *= Math.sqrt(maxCanvasPixels / estimatedPixels);
			}
			const scaledViewport = page.getViewport({ scale: renderScale });
			const cssViewport = page.getViewport({ scale: cssScale });
			wrapper.style.setProperty('--scale-factor', String(cssViewport.scale));

			const canvas = document.createElement('canvas');
			canvas.width = scaledViewport.width;
			canvas.height = scaledViewport.height;
			canvas.style.width = `${Math.round(cssScale * viewport.width)}px`;
			canvas.style.height = `${Math.round(cssScale * viewport.height)}px`;
			canvas.style.display = 'block';
			const ctx = canvas.getContext('2d');
			if (!ctx) throw new Error('PDF canvas is unavailable');
			renderTask = page.render({ canvasContext: ctx, viewport: scaledViewport });
			pageRenderTasks.set(wrapper, renderTask);
			await renderTask.promise;
			if (
				documentToRender !== pdfDoc ||
				!wrapper.isConnected ||
				pageRenderTokens.get(wrapper) !== renderToken
			)
				return;

			const textLayerDiv = document.createElement('div');
			textLayerDiv.className = 'textLayer';
			const textContent = await page.getTextContent();
			const textLayer = new pdfjs.TextLayer({
				textContentSource: textContent,
				container: textLayerDiv,
				viewport: cssViewport
			});
			await textLayer.render();
			if (
				documentToRender !== pdfDoc ||
				!wrapper.isConnected ||
				pageRenderTokens.get(wrapper) !== renderToken
			) {
				textLayer.cancel?.();
				return;
			}
			wrapper.replaceChildren(canvas, textLayerDiv);
			pageTextLayers.set(wrapper, textLayer);
			wrapper.dataset.renderState = 'rendered';
		} catch (cause) {
			if ((cause as { name?: string })?.name !== 'RenderingCancelledException') {
				console.error(`PDF page ${pageNumber} render failed:`, cause);
			}
			if (wrapper.isConnected && pageRenderTokens.get(wrapper) === renderToken) {
				releasePage(wrapper);
			}
		} finally {
			if (pageRenderTasks.get(wrapper) === renderTask) pageRenderTasks.delete(wrapper);
		}
	};

	const observePages = () => {
		pageObserver?.disconnect();
		pageObserver = new IntersectionObserver(
			(entries) => {
				for (const entry of entries) {
					const wrapper = entry.target as HTMLElement;
					if (entry.isIntersecting) void renderPage(wrapper);
					else if (wrapper.dataset.renderState !== 'idle') releasePage(wrapper);
				}
			},
			{ root: outerContainer, rootMargin: '150% 0px' }
		);
		for (const wrapper of sceneElement.querySelectorAll<HTMLElement>('.pdf-page-wrapper')) {
			pageObserver.observe(wrapper);
		}
	};

	const rerenderPages = async (forZoom: number) => {
		if (!pdfDoc || !sceneElement) return;
		const rendered = [...sceneElement.querySelectorAll<HTMLElement>('.pdf-page-wrapper')].filter(
			(wrapper) => wrapper.dataset.renderState === 'rendered'
		);
		for (const wrapper of rendered) {
			releasePage(wrapper);
			await renderPage(wrapper);
		}
		lastRenderedZoom = forZoom;
	};

	const preparePagePlaceholders = async (
		documentToRender: any,
		targetScene: HTMLDivElement,
		generation: number
	) => {
		for (let i = 1; i <= documentToRender.numPages; i++) {
			if (generation !== loadGeneration) throw new DOMException('Render superseded', 'AbortError');
			const page = await documentToRender.getPage(i);
			const viewport = page.getViewport({ scale: 1 });
			const containerWidth = Math.max(
				320,
				Math.min((outerContainer?.clientWidth || 800) - 24, 1024)
			);
			const cssScale = containerWidth / viewport.width;
			const cssViewport = page.getViewport({ scale: cssScale });
			const wrapper = document.createElement('div');
			wrapper.className = 'pdf-page-wrapper';
			wrapper.dataset.pageNumber = String(i);
			wrapper.dataset.renderState = 'idle';
			wrapper.style.position = 'relative';
			wrapper.style.width = `${Math.round(cssScale * viewport.width)}px`;
			wrapper.style.height = `${Math.round(cssScale * viewport.height)}px`;
			wrapper.style.display = 'block';
			wrapper.style.setProperty('--scale-factor', String(cssViewport.scale));
			targetScene.appendChild(wrapper);
		}
	};

	const loadPdf = async () => {
		if (!url && !data) return;
		const generation = ++loadGeneration;
		const previousScrollTop = outerContainer?.scrollTop ?? 0;
		const previousZoom = zoomLevel;
		let candidatePdfDoc: any = null;

		loading = true;
		error = '';

		try {
			const pdfjs = await import('pdfjs-dist');
			pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

			let pdfData: ArrayBuffer | Uint8Array;
			if (data) {
				pdfData = data;
			} else {
				// Fetch with credentials so auth cookies are sent
				const res = await fetch(url!, { credentials: 'include' });
				if (!res.ok) throw new Error(`HTTP ${res.status}`);
				pdfData = await res.arrayBuffer();
			}
			candidatePdfDoc = await pdfjs.getDocument({ data: pdfData }).promise;
			if (candidatePdfDoc.numPages > 1000) {
				throw new Error('PDF exceeds the viewer page limit');
			}
			if (generation !== loadGeneration) {
				await candidatePdfDoc.destroy();
				return;
			}
			const candidateScene = document.createElement('div');
			await preparePagePlaceholders(candidatePdfDoc, candidateScene, generation);
			if (generation !== loadGeneration) {
				await candidatePdfDoc.destroy();
				return;
			}

			const previousPdfDoc = pdfDoc;
			releaseAllPages();
			pzInstance?.dispose();
			sceneElement.replaceChildren(...candidateScene.childNodes);
			pdfDoc = candidatePdfDoc;
			loadedData = data;
			loadedUrl = url;
			lastRenderedZoom = 1;
			initPanzoom();
			if (previousZoom !== 1 && pzInstance) {
				pzInstance.zoomAbs(0, 0, previousZoom);
				zoomLevel = previousZoom;
			}
			if (outerContainer) outerContainer.scrollTop = previousScrollTop;
			observePages();
			await previousPdfDoc?.destroy();
		} catch (e) {
			if (candidatePdfDoc && candidatePdfDoc !== pdfDoc) await candidatePdfDoc.destroy();
			if (generation !== loadGeneration) return;
			console.error('PDF render error:', e);
			error = 'Failed to load PDF.';
		} finally {
			if (generation === loadGeneration) loading = false;
		}
	};

	onMount(() => {
		mounted = true;
	});

	onDestroy(() => {
		mounted = false;
		loadGeneration += 1;
		if (rerenderTimer) clearTimeout(rerenderTimer);
		pzInstance?.dispose();
		releaseAllPages();
		if (pdfDoc) {
			pdfDoc.destroy();
			pdfDoc = null;
		}
	});

	$: if (mounted && (data !== loadedData || url !== loadedUrl)) void loadPdf();
</script>

<div class="relative {className}">
	{#if loading && !pdfDoc}
		<div class="absolute inset-0 flex items-center justify-center">
			<Spinner className="size-5" />
		</div>
	{:else if loading}
		<div
			role="status"
			aria-label="Updating PDF preview"
			class="absolute right-3 top-3 z-20 rounded-full bg-white/90 p-2 shadow-sm dark:bg-gray-850/90"
		>
			<Spinner className="size-4" />
		</div>
	{:else if error && !pdfDoc}
		<div
			role="alert"
			class="absolute inset-0 flex items-center justify-center text-sm text-red-500"
		>
			{error}
		</div>
	{:else if error}
		<div
			role="alert"
			class="absolute bottom-12 left-1/2 z-20 -translate-x-1/2 rounded-full bg-red-50 px-3 py-1.5 text-xs text-red-700 shadow-sm dark:bg-red-950/90 dark:text-red-200"
		>
			The latest update could not be displayed. Showing the previous version.
		</div>
	{/if}

	<div class="overflow-y-auto h-full" bind:this={outerContainer}>
		<div bind:this={sceneElement} class="flex w-full flex-col items-center gap-5"></div>
	</div>

	{#if !loading && pdfDoc}
		<div
			class="absolute bottom-3 left-1/2 -translate-x-1/2 z-10 flex items-center gap-0.5 rounded-lg bg-white/90 dark:bg-gray-850/90 backdrop-blur-sm shadow-lg border border-gray-200/60 dark:border-gray-700/60 px-1 py-0.5"
		>
			<button
				class="p-1.5 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 transition text-gray-500 dark:text-gray-400"
				on:click={zoomOut}
				aria-label="Zoom out"
			>
				<svg
					xmlns="http://www.w3.org/2000/svg"
					viewBox="0 0 20 20"
					fill="currentColor"
					class="size-3.5"
				>
					<path
						fill-rule="evenodd"
						d="M4 10a.75.75 0 0 1 .75-.75h10.5a.75.75 0 0 1 0 1.5H4.75A.75.75 0 0 1 4 10Z"
						clip-rule="evenodd"
					/>
				</svg>
			</button>
			<button
				class="px-1.5 py-1 min-w-[3rem] text-center text-[11px] font-normal text-gray-500 dark:text-gray-400 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 transition tabular-nums"
				on:click={resetView}
				aria-label="Reset zoom"
			>
				{Math.round(zoomLevel * 100)}%
			</button>
			<button
				class="p-1.5 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 transition text-gray-500 dark:text-gray-400"
				on:click={zoomIn}
				aria-label="Zoom in"
			>
				<svg
					xmlns="http://www.w3.org/2000/svg"
					viewBox="0 0 20 20"
					fill="currentColor"
					class="size-3.5"
				>
					<path
						d="M10.75 4.75a.75.75 0 0 0-1.5 0v4.5h-4.5a.75.75 0 0 0 0 1.5h4.5v4.5a.75.75 0 0 0 1.5 0v-4.5h4.5a.75.75 0 0 0 0-1.5h-4.5v-4.5Z"
					/>
				</svg>
			</button>
		</div>
	{/if}
</div>

<style>
	/*
	 * Minimal textLayer styles extracted from pdfjs-dist/web/pdf_viewer.css.
	 * These ensure the invisible text spans are positioned exactly over the
	 * rendered canvas so that browser-native Ctrl+F search and text selection
	 * work correctly.
	 */
	:global(.textLayer) {
		position: absolute;
		text-align: initial;
		inset: 0;
		overflow: clip;
		opacity: 1;
		line-height: 1;
		-webkit-text-size-adjust: none;
		-moz-text-size-adjust: none;
		text-size-adjust: none;
		forced-color-adjust: none;
		transform-origin: 0 0;
		caret-color: CanvasText;
		z-index: 0;
	}

	:global(.textLayer :is(span, br)) {
		color: transparent;
		position: absolute;
		white-space: pre;
		cursor: text;
		transform-origin: 0% 0%;
	}

	:global(.textLayer) {
		/* --total-scale-factor is derived from --scale-factor (set on the wrapper)
		   and --user-unit (defaults to 1). This mirrors the official pdf_viewer.css. */
		--user-unit: 1;
		--total-scale-factor: calc(var(--scale-factor) * var(--user-unit));
		--min-font-size: 1;
		--text-scale-factor: calc(var(--total-scale-factor) * var(--min-font-size));
		--min-font-size-inv: calc(1 / var(--min-font-size));
	}

	:global(.textLayer > :not(.markedContent)),
	:global(.textLayer .markedContent span:not(.markedContent)) {
		z-index: 1;
		--font-height: 0;
		font-size: calc(var(--text-scale-factor) * var(--font-height));
		--scale-x: 1;
		--rotate: 0deg;
		transform: rotate(var(--rotate)) scaleX(var(--scale-x)) scale(var(--min-font-size-inv));
	}

	:global(.textLayer .markedContent) {
		display: contents;
	}

	:global(.textLayer span[role='img']) {
		-webkit-user-select: none;
		-moz-user-select: none;
		user-select: none;
		cursor: default;
	}

	/* Selection highlight color */
	:global(.textLayer ::-moz-selection) {
		background: rgba(0, 0, 255, 0.25);
	}

	:global(.textLayer ::selection) {
		background: rgba(0, 0, 255, 0.25);
	}

	:global(.textLayer br::-moz-selection) {
		background: transparent;
	}

	:global(.textLayer br::selection) {
		background: transparent;
	}

	:global(.textLayer .endOfContent) {
		display: block;
		position: absolute;
		inset: 100% 0 0;
		z-index: 0;
		cursor: default;
		-webkit-user-select: none;
		-moz-user-select: none;
		user-select: none;
	}

	:global(.textLayer.selecting .endOfContent) {
		top: 0;
	}

	:global(.pdf-page-wrapper) {
		background: white;
		box-shadow: 0 16px 42px rgba(25, 24, 22, 0.12);
		overflow: hidden;
	}

	:global(.dark .pdf-page-wrapper) {
		box-shadow: 0 18px 48px rgba(0, 0, 0, 0.4);
	}
</style>
