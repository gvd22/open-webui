<script lang="ts">
	import { createEventDispatcher, onMount, onDestroy, tick } from 'svelte';
	import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url';
	import panzoom, { type PanZoom } from 'panzoom';
	import { clampDocumentTargetPage } from '$lib/utils/documentPreview';
	import Spinner from './Spinner.svelte';
	import DocumentPagination from './DocumentPagination.svelte';
	import DocumentZoomControls from './DocumentZoomControls.svelte';
	import {
		clampDocumentZoom,
		DOCUMENT_ZOOM_BUTTON_STEP,
		DOCUMENT_ZOOM_MAX,
		getDocumentWheelZoomDelta,
		panDocumentViewport
	} from './documentZoom';

	export let url: string | null = null;
	export let data: ArrayBuffer | Uint8Array | null = null;
	export let className = 'w-full h-[70vh]';
	export let targetPage: number | null = null;
	export let singlePage = false;
	export let itemLabel = 'Page';
	export let onPageChange: ((page: number) => void) | null = null;

	type PdfDocument = import('pdfjs-dist').PDFDocumentProxy;
	type PdfTextLayer = InstanceType<typeof import('pdfjs-dist').TextLayer>;
	const dispatch = createEventDispatcher<{
		'preview-rendered': ArrayBuffer | Uint8Array | null;
		'preview-failed': ArrayBuffer | Uint8Array | null;
	}>();

	let outerContainer: HTMLDivElement;
	let sceneElement: HTMLDivElement;
	let loading = true;
	let error = '';
	let pdfDoc: PdfDocument | null = null;
	let pzInstance: PanZoom | null = null;
	let zoomLevel = 1;
	let rerenderTimer: ReturnType<typeof setTimeout> | null = null;
	let lastRenderedZoom = 1;
	let pageCount = 0;
	let renderedPage = 0;
	let currentPage = 1;
	let loadToken = 0;
	let renderToken = 0;
	let fetchController: AbortController | null = null;
	let pdfLoadingTask: ReturnType<typeof import('pdfjs-dist').getDocument> | null = null;
	let scrollFrame: number | null = null;
	let mounted = false;
	let loadedSource: ArrayBuffer | Uint8Array | string | null = null;
	let wheelDelta = 0;
	let lastWheelNavigationAt = 0;
	const wheelNavigationThreshold = 80;
	const wheelNavigationCooldown = 450;
	const pageShortcutKeys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];

	$: selectedPage = singlePage
		? (clampDocumentTargetPage(targetPage, pageCount) ?? 1)
		: currentPage;

	const cancelPendingLoad = () => {
		fetchController?.abort();
		fetchController = null;
		const loadingTask = pdfLoadingTask;
		pdfLoadingTask = null;
		loadingTask?.destroy?.();
	};

	// Keep a reference to TextLayer instances so we can update/cancel them
	let textLayerInstances: PdfTextLayer[] = [];

	const copyPdfData = (pdfData: ArrayBuffer | Uint8Array) =>
		pdfData instanceof Uint8Array ? pdfData.slice() : pdfData.slice(0);

	const cancelTextLayers = () => {
		for (const tl of textLayerInstances) {
			try {
				tl.cancel();
			} catch {
				// Text layers can already be resolved or canceled during rerenders.
			}
		}
		textLayerInstances = [];
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
				maxZoom: DOCUMENT_ZOOM_MAX / 100,
				beforeWheel: () => true,
				beforeMouseDown: (e) => {
					// Only allow drag-to-pan when zoomed in (not at default scale)
					if ((e?.target as HTMLElement | null)?.closest?.('.textLayer')) {
						return true;
					}
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

	const setZoom = (percent: number, anchorX?: number, anchorY?: number) => {
		if (!pzInstance || !outerContainer) return;
		const nextZoom = clampDocumentZoom(percent) / 100;
		pzInstance.zoomAbs(
			anchorX ?? outerContainer.clientWidth / 2,
			anchorY ?? outerContainer.clientHeight / 2,
			nextZoom
		);
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

	export const scrollToPage = async (page: number | null) => {
		targetPage = page;
		if (singlePage) {
			if (targetPage) onPageChange?.(targetPage);
		} else {
			await scrollToTargetPage();
		}
	};

	const selectPage = async (page: number) => {
		if (!pdfDoc) return;
		const nextPage = clampDocumentTargetPage(page, pdfDoc.numPages);
		if (!nextPage || nextPage === selectedPage) return;

		targetPage = nextPage;
		currentPage = nextPage;
		onPageChange?.(nextPage);
		if (!singlePage) await scrollToTargetPage();
	};

	const scrollToTargetPage = async () => {
		if (!outerContainer || !sceneElement || !pdfDoc) return;
		const page = clampDocumentTargetPage(targetPage, pdfDoc.numPages);
		if (!page) return;

		if (singlePage) return;

		await tick();
		const pageWrapper = sceneElement.querySelectorAll('.pdf-page-wrapper')[page - 1] as
			| HTMLElement
			| undefined;
		pageWrapper?.scrollIntoView({ block: 'start' });
		currentPage = page;
		onPageChange?.(page);
	};

	const syncVisiblePage = () => {
		scrollFrame = null;
		if (singlePage || !outerContainer || !sceneElement || !pdfDoc) return;

		const marker = outerContainer.getBoundingClientRect().top + outerContainer.clientHeight * 0.35;
		let bestPage = currentPage;
		let bestDistance = Number.POSITIVE_INFINITY;

		for (const wrapper of sceneElement.querySelectorAll('.pdf-page-wrapper')) {
			const el = wrapper as HTMLElement;
			const page = Number(el.dataset.pageNumber);
			if (!page) continue;

			const rect = el.getBoundingClientRect();
			const distance =
				marker < rect.top ? rect.top - marker : marker > rect.bottom ? marker - rect.bottom : 0;
			if (distance < bestDistance) {
				bestDistance = distance;
				bestPage = page;
			}
		}

		if (bestPage !== currentPage) {
			currentPage = bestPage;
			onPageChange?.(bestPage);
		}
	};

	const handleScroll = () => {
		if (singlePage || scrollFrame !== null) return;
		scrollFrame = requestAnimationFrame(syncVisiblePage);
	};

	// Re-render existing canvases at a new zoom level (preserves panzoom transform)
	const rerenderPages = async (forZoom: number) => {
		if (!pdfDoc || !sceneElement) return;
		const pdfjs = await import('pdfjs-dist');
		const dpr = window.devicePixelRatio || 1;

		const pageWrappers = sceneElement.querySelectorAll('.pdf-page-wrapper');

		cancelTextLayers();

		for (let i = 0; i < pageWrappers.length; i++) {
			const page = await pdfDoc.getPage(singlePage ? selectedPage : i + 1);
			const viewport = page.getViewport({ scale: 1 });
			const cssScale = getCssScale(viewport);
			const renderScale = cssScale * forZoom * dpr;
			const scaledViewport = page.getViewport({ scale: renderScale });
			const cssViewport = page.getViewport({ scale: cssScale });

			const wrapper = pageWrappers[i] as HTMLElement;
			// Update the CSS custom property so textLayer dimensions resolve correctly
			wrapper.style.setProperty('--scale-factor', String(cssViewport.scale));

			const canvas = wrapper.querySelector('canvas')!;
			canvas.width = scaledViewport.width;
			canvas.height = scaledViewport.height;

			const ctx = canvas.getContext('2d');
			if (ctx) {
				await page.render({ canvas, canvasContext: ctx, viewport: scaledViewport }).promise;
			}

			// Rebuild text layer
			const textLayerDiv = wrapper.querySelector('.textLayer') as HTMLElement;
			if (textLayerDiv) {
				textLayerDiv.innerHTML = '';

				const textContent = await page.getTextContent();
				const textLayer = new pdfjs.TextLayer({
					textContentSource: textContent,
					container: textLayerDiv,
					viewport: cssViewport
				});
				await textLayer.render();
				textLayerInstances.push(textLayer);
			}
		}
		lastRenderedZoom = forZoom;
	};

	const getCssScale = (viewport: { width: number; height: number }) => {
		if (!singlePage) return (outerContainer?.clientWidth || 800) / viewport.width;

		const availableWidth = Math.max(320, (outerContainer?.clientWidth || 800) - 64);
		const availableHeight = Math.max(220, (outerContainer?.clientHeight || 600) - 64);
		return Math.min(1, availableWidth / viewport.width, availableHeight / viewport.height);
	};

	const renderAllPages = async () => {
		if (!pdfDoc || !sceneElement) return;
		const token = ++renderToken;

		// Clear previous content
		sceneElement.innerHTML = '';

		cancelTextLayers();

		const pdfjs = await import('pdfjs-dist');
		const dpr = window.devicePixelRatio || 1;
		const wrappers: HTMLElement[] = [];
		const firstPage = singlePage ? selectedPage : 1;
		const lastPage = singlePage ? selectedPage : pdfDoc.numPages;

		for (let i = firstPage; i <= lastPage; i++) {
			const page = await pdfDoc.getPage(i);
			if (token !== renderToken) return;
			const viewport = page.getViewport({ scale: 1 });

			// Scale to fit container width
			const cssScale = getCssScale(viewport);
			const renderScale = cssScale * dpr;
			const scaledViewport = page.getViewport({ scale: renderScale });
			const cssViewport = page.getViewport({ scale: cssScale });

			// Create page wrapper (positioned container for canvas + text layer)
			const wrapper = document.createElement('div');
			wrapper.className = 'pdf-page-wrapper';
			wrapper.dataset.pageNumber = String(i);
			wrapper.style.position = 'relative';
			wrapper.style.width = `${Math.round(cssScale * viewport.width)}px`;
			wrapper.style.height = `${Math.round(cssScale * viewport.height)}px`;
			wrapper.style.display = 'block';
			// pdfjs TextLayer uses --total-scale-factor (= --scale-factor * --user-unit)
			// to position/size text spans. We must set --scale-factor so the calc resolves.
			wrapper.style.setProperty('--scale-factor', String(cssViewport.scale));

			if (i > 1) {
				wrapper.style.marginTop = '4px';
			}

			// Create canvas
			const canvas = document.createElement('canvas');
			canvas.width = scaledViewport.width;
			canvas.height = scaledViewport.height;
			// CSS size stays at the CSS-pixel dimensions for layout
			canvas.style.width = `${Math.round(cssScale * viewport.width)}px`;
			canvas.style.height = `${Math.round(cssScale * viewport.height)}px`;
			canvas.style.display = 'block';
			wrapper.appendChild(canvas);

			const ctx = canvas.getContext('2d');
			if (!ctx) continue;

			await page.render({
				canvas,
				canvasContext: ctx,
				viewport: scaledViewport
			}).promise;
			if (token !== renderToken) return;

			// Create text layer overlay — pdfjs setLayerDimensions handles its sizing
			const textLayerDiv = document.createElement('div');
			textLayerDiv.className = 'textLayer';
			wrapper.appendChild(textLayerDiv);

			const textContent = await page.getTextContent();
			const textLayer = new pdfjs.TextLayer({
				textContentSource: textContent,
				container: textLayerDiv,
				viewport: cssViewport
			});
			await textLayer.render();
			if (token !== renderToken) return;
			textLayerInstances.push(textLayer);

			wrappers.push(wrapper);
		}

		sceneElement.replaceChildren(...wrappers);
		lastRenderedZoom = 1;
		renderedPage = singlePage ? selectedPage : 0;
		initPanzoom();
		await scrollToTargetPage();
		syncVisiblePage();
	};

	const handleWheel = (e: WheelEvent) => {
		if (e.ctrlKey || e.metaKey) {
			e.preventDefault();
			const rect = outerContainer.getBoundingClientRect();
			setZoom(
				zoomLevel * 100 + getDocumentWheelZoomDelta(e.deltaY),
				e.clientX - rect.left,
				e.clientY - rect.top
			);
			return;
		}

		const transform = pzInstance?.getTransform();
		if (transform && Math.abs(transform.scale - 1) >= 0.01) {
			e.preventDefault();
			const beforeLeft = outerContainer.scrollLeft;
			const beforeTop = outerContainer.scrollTop;
			panDocumentViewport(outerContainer, e.deltaX, e.deltaY);
			if (beforeLeft === outerContainer.scrollLeft && beforeTop === outerContainer.scrollTop) {
				pzInstance?.moveBy(-e.deltaX, -e.deltaY, false);
			}
			zoomLevel = pzInstance?.getTransform()?.scale ?? 1;
			return;
		}

		if (!singlePage) return;

		e.preventDefault();
		if (pageCount <= 1) return;

		const multiplier = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? outerContainer.clientHeight : 1;
		const dominantDelta = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
		wheelDelta += dominantDelta * multiplier;

		const now = Date.now();
		if (Math.abs(wheelDelta) < wheelNavigationThreshold) return;
		if (now - lastWheelNavigationAt < wheelNavigationCooldown) {
			wheelDelta = 0;
			return;
		}

		lastWheelNavigationAt = now;
		void selectPage(selectedPage + (wheelDelta > 0 ? 1 : -1));
		wheelDelta = 0;
	};

	const handleKeyDown = (e: KeyboardEvent) => {
		if (
			!singlePage ||
			e.defaultPrevented ||
			e.altKey ||
			e.ctrlKey ||
			e.metaKey ||
			pageCount <= 1 ||
			!pageShortcutKeys.includes(e.key)
		) {
			return;
		}

		e.preventDefault();
		void selectPage(selectedPage + (e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 1));
	};

	const focusViewer = () => {
		if (!outerContainer?.contains(document.activeElement)) outerContainer?.focus();
	};

	const loadPdf = async () => {
		if (!url && !data) return;

		const source = data ?? url;
		if (source === loadedSource && pdfDoc) return;
		const token = ++loadToken;
		cancelPendingLoad();
		loadedSource = source;
		loading = true;
		error = '';
		renderedPage = 0;
		pageCount = 0;
		pzInstance?.dispose();
		cancelTextLayers();
		pdfDoc?.destroy();
		pdfDoc = null;

		try {
			const pdfjs = await import('pdfjs-dist');
			pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

			let pdfData: ArrayBuffer | Uint8Array;
			if (data) {
				pdfData = copyPdfData(data);
			} else {
				// Fetch with credentials so auth cookies are sent
				const controller = new AbortController();
				fetchController = controller;
				try {
					const res = await fetch(url!, {
						credentials: 'include',
						signal: controller.signal
					});
					if (!res.ok) throw new Error(`HTTP ${res.status}`);
					pdfData = await res.arrayBuffer();
				} finally {
					if (fetchController === controller) fetchController = null;
				}
			}
			const loadingTask = pdfjs.getDocument({ data: pdfData });
			pdfLoadingTask = loadingTask;
			let candidatePdfDoc: PdfDocument;
			try {
				candidatePdfDoc = await loadingTask.promise;
			} finally {
				if (pdfLoadingTask === loadingTask) pdfLoadingTask = null;
			}
			if (token !== loadToken) {
				await candidatePdfDoc.destroy();
				return;
			}
			pdfDoc = candidatePdfDoc;
			pageCount = pdfDoc.numPages;
			currentPage = clampDocumentTargetPage(targetPage, pageCount) ?? 1;
			targetPage = clampDocumentTargetPage(targetPage, pageCount) ?? 1;
			await renderAllPages();
			if (token === loadToken) dispatch('preview-rendered', data);
		} catch (e) {
			if (token === loadToken) {
				if ((e as { name?: string })?.name === 'AbortError') return;
				console.error('PDF render error:', e);
				error = 'Failed to load PDF.';
				dispatch('preview-failed', data);
			}
		} finally {
			if (token === loadToken) loading = false;
		}
	};

	onMount(() => {
		mounted = true;
		loadPdf();
	});

	$: if (mounted && (data || url)) {
		void loadPdf();
	}

	$: if (!loading && pdfDoc && singlePage && targetPage && selectedPage !== renderedPage) {
		void renderAllPages();
	}

	$: if (!loading && pdfDoc && !singlePage && targetPage) {
		void scrollToTargetPage();
	}

	onDestroy(() => {
		loadToken++;
		renderToken++;
		cancelPendingLoad();
		if (scrollFrame !== null) cancelAnimationFrame(scrollFrame);
		if (rerenderTimer) clearTimeout(rerenderTimer);
		pzInstance?.dispose();
		cancelTextLayers();
		if (pdfDoc) {
			pdfDoc.destroy();
			pdfDoc = null;
		}
	});
</script>

<div class="relative {className}">
	{#if loading}
		<div class="absolute inset-0 flex items-center justify-center">
			<Spinner className="size-5" />
		</div>
	{:else if error}
		<div class="absolute inset-0 flex items-center justify-center text-sm text-red-500">
			{error}
		</div>
	{/if}

	<div
		class={singlePage
			? 'overflow-hidden h-full flex items-center justify-center overscroll-contain'
			: 'overflow-y-auto h-full'}
		bind:this={outerContainer}
		role="region"
		aria-label={singlePage
			? `${itemLabel}, ${selectedPage} of ${pageCount}`
			: `PDF document, page ${currentPage} of ${pdfDoc?.numPages ?? 0}`}
		tabindex="0"
		on:scroll={handleScroll}
		on:wheel|nonpassive={handleWheel}
		on:pointerdown={focusViewer}
		on:keydown={handleKeyDown}
	>
		<div bind:this={sceneElement} class={singlePage ? '' : 'w-full'}></div>
	</div>

	{#if !error && pdfDoc}
		<div class="absolute bottom-3 left-1/2 z-20 -translate-x-1/2">
			<DocumentPagination
				current={selectedPage}
				total={pageCount}
				previousLabel={`Previous ${itemLabel.toLowerCase()}`}
				nextLabel={`Next ${itemLabel.toLowerCase()}`}
				onPrevious={() => selectPage(selectedPage - 1)}
				onNext={() => selectPage(selectedPage + 1)}
			>
				<DocumentZoomControls
					percent={Math.round(zoomLevel * 100)}
					maximum={DOCUMENT_ZOOM_MAX}
					onZoomOut={() => setZoom(zoomLevel * 100 - DOCUMENT_ZOOM_BUTTON_STEP)}
					onReset={resetView}
					onZoomIn={() => setZoom(zoomLevel * 100 + DOCUMENT_ZOOM_BUTTON_STEP)}
				/>
			</DocumentPagination>
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
</style>
