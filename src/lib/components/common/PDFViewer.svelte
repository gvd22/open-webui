<script lang="ts">
	import { createEventDispatcher, onDestroy, onMount } from 'svelte';
	import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url';
	import panzoom, { type PanZoom } from 'panzoom';
	import Spinner from './Spinner.svelte';
	import {
		findMatchingPages,
		getOwnedPreviousPdfToDestroy,
		getPageAnchor,
		getScrollTopForPageAnchor,
		scanPdfText,
		type PdfPageMetric
	} from './pdfViewerHelpers';

	export let url: string | null = null;
	export let data: ArrayBuffer | Uint8Array | null = null;
	export let className = 'w-full h-[70vh]';

	const dispatch = createEventDispatcher<{
		'preview-rendered': ArrayBuffer | Uint8Array | null;
		'preview-failed': ArrayBuffer | Uint8Array | null;
	}>();

	let outerContainer: HTMLDivElement;
	let sceneElement: HTMLDivElement;
	let loading = true;
	let error = '';
	let pdfDoc: any = null;
	let pzInstance: PanZoom | null = null;
	let zoomLevel = 1;
	let rerenderTimer: ReturnType<typeof setTimeout> | null = null;
	let resizeTimer: ReturnType<typeof setTimeout> | null = null;
	let resizeFrame: number | null = null;
	let lastRenderedZoom = 1;
	let mounted = false;
	let loadedData: ArrayBuffer | Uint8Array | null = null;
	let loadedUrl: string | null = null;
	let loadGeneration = 0;
	let textIndexGeneration = 0;
	let searchGeneration = 0;
	let resizeObserver: ResizeObserver | null = null;
	let currentPage = 1;
	let searchQuery = '';
	let searchResults: number[] = [];
	let searchResultIndex = -1;
	let searchIndexing = false;

	let pageObserver: IntersectionObserver | null = null;
	const pageTextLayers = new Map<HTMLElement, any>();
	const pageRenderTasks = new Map<HTMLElement, any>();
	const pageRenderTokens = new WeakMap<HTMLElement, symbol>();
	const pageTextIndex = new Map<number, string>();
	const maxIndexedTextBytes = 24_000_000;

	const getPageMetrics = (): PdfPageMetric[] =>
		[...(sceneElement?.querySelectorAll<HTMLElement>('.pdf-page-wrapper') ?? [])].map(
			(wrapper) => ({
				pageNumber: Number(wrapper.dataset.pageNumber),
				top: wrapper.offsetTop,
				height: wrapper.offsetHeight
			})
		);

	const updateCurrentPage = () => {
		const anchor = getPageAnchor(getPageMetrics(), outerContainer?.scrollTop ?? 0);
		if (anchor) currentPage = anchor.pageNumber;
	};

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
		pzInstance?.dispose();
		if (!sceneElement) return;
		pzInstance = panzoom(sceneElement, {
			bounds: true,
			boundsPadding: 0.1,
			minZoom: 0.5,
			maxZoom: 4,
			zoomSpeed: 0.065,
			beforeWheel: (event) => !event.ctrlKey && !event.metaKey,
			beforeMouseDown: () => Math.abs((pzInstance?.getTransform().scale ?? 1) - 1) < 0.01
		});
		pzInstance.on('zoom', () => {
			zoomLevel = pzInstance?.getTransform().scale ?? 1;
			if (rerenderTimer) clearTimeout(rerenderTimer);
			rerenderTimer = setTimeout(() => {
				if (Math.abs(zoomLevel - lastRenderedZoom) > 0.05) rerenderVisiblePages(zoomLevel);
			}, 300);
		});
	};

	const zoomIn = () => {
		if (!pzInstance || !outerContainer) return;
		pzInstance.zoomTo(outerContainer.clientWidth / 2, outerContainer.clientHeight / 2, 1.25);
		zoomLevel = pzInstance.getTransform().scale;
	};

	const zoomOut = () => {
		if (!pzInstance || !outerContainer) return;
		pzInstance.zoomTo(outerContainer.clientWidth / 2, outerContainer.clientHeight / 2, 0.8);
		zoomLevel = pzInstance.getTransform().scale;
	};

	export const resetView = () => {
		if (!pzInstance) return;
		pzInstance.moveTo(0, 0);
		pzInstance.zoomAbs(0, 0, 1);
		zoomLevel = 1;
		rerenderVisiblePages(1);
	};

	const renderPage = async (wrapper: HTMLElement): Promise<boolean> => {
		if (!pdfDoc || wrapper.dataset.renderState !== 'idle') return false;
		const documentToRender = pdfDoc;
		const pageNumber = Number(wrapper.dataset.pageNumber);
		const renderToken = Symbol(`pdf-page-${pageNumber}`);
		pageRenderTokens.set(wrapper, renderToken);
		wrapper.dataset.renderState = 'loading';
		const pdfjs = await import('pdfjs-dist');
		if (pageRenderTokens.get(wrapper) !== renderToken) return false;

		let renderTask: any = null;
		try {
			const page = await documentToRender.getPage(pageNumber);
			if (documentToRender !== pdfDoc || pageRenderTokens.get(wrapper) !== renderToken)
				return false;
			const viewport = page.getViewport({ scale: 1 });
			wrapper.style.aspectRatio = `${viewport.width} / ${viewport.height}`;
			const containerWidth = Math.max(
				320,
				Math.min((outerContainer?.clientWidth || 800) - 24, 1024)
			);
			const cssScale = containerWidth / viewport.width;
			let renderScale = cssScale * zoomLevel * (window.devicePixelRatio || 1);
			const estimatedPixels = viewport.width * renderScale * (viewport.height * renderScale);
			const maxCanvasPixels = 24_000_000;
			if (estimatedPixels > maxCanvasPixels)
				renderScale *= Math.sqrt(maxCanvasPixels / estimatedPixels);
			const scaledViewport = page.getViewport({ scale: renderScale });
			const cssViewport = page.getViewport({ scale: cssScale });
			wrapper.style.setProperty('--scale-factor', String(cssViewport.scale));

			const canvas = document.createElement('canvas');
			canvas.width = scaledViewport.width;
			canvas.height = scaledViewport.height;
			canvas.style.cssText = 'display:block;width:100%;height:auto;';
			const canvasContext = canvas.getContext('2d');
			if (!canvasContext) throw new Error('PDF canvas is unavailable');
			renderTask = page.render({ canvasContext, viewport: scaledViewport });
			pageRenderTasks.set(wrapper, renderTask);
			await renderTask.promise;
			if (
				documentToRender !== pdfDoc ||
				!wrapper.isConnected ||
				pageRenderTokens.get(wrapper) !== renderToken
			)
				return false;

			const textLayerDiv = document.createElement('div');
			textLayerDiv.className = 'textLayer';
			const textLayer = new pdfjs.TextLayer({
				textContentSource: await page.getTextContent(),
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
				return false;
			}
			wrapper.replaceChildren(canvas, textLayerDiv);
			pageTextLayers.set(wrapper, textLayer);
			wrapper.dataset.renderState = 'rendered';
			return true;
		} catch (cause) {
			if ((cause as { name?: string })?.name !== 'RenderingCancelledException') {
				console.error(`PDF page ${pageNumber} render failed:`, cause);
			}
			if (wrapper.isConnected && pageRenderTokens.get(wrapper) === renderToken)
				releasePage(wrapper);
			return false;
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

	const rerenderVisiblePages = (forZoom: number) => {
		if (!pdfDoc || !sceneElement || !outerContainer) return;
		const root = outerContainer.getBoundingClientRect();
		for (const wrapper of sceneElement.querySelectorAll<HTMLElement>('.pdf-page-wrapper')) {
			const rect = wrapper.getBoundingClientRect();
			if (rect.bottom >= root.top - root.height && rect.top <= root.bottom + root.height) {
				releasePage(wrapper);
				void renderPage(wrapper);
			}
		}
		lastRenderedZoom = forZoom;
	};

	const preparePagePlaceholders = (documentToRender: any, targetScene: HTMLDivElement) => {
		const placeholders = document.createDocumentFragment();
		for (let pageNumber = 1; pageNumber <= documentToRender.numPages; pageNumber++) {
			const wrapper = document.createElement('div');
			wrapper.className = 'pdf-page-wrapper';
			wrapper.dataset.pageNumber = String(pageNumber);
			wrapper.dataset.renderState = 'idle';
			wrapper.style.cssText = 'position:relative;width:min(100%, 1024px);aspect-ratio:1 / 1.4142;';
			placeholders.appendChild(wrapper);
		}
		targetScene.appendChild(placeholders);
	};

	const publishSearchResults = (matches: number[]) => {
		const selectedPage = searchResults[searchResultIndex];
		searchResults = matches;
		searchResultIndex = searchResults.indexOf(selectedPage);
		if (searchResultIndex === -1 && searchResults.length) {
			searchResultIndex = Math.max(
				0,
				searchResults.findIndex((page) => page >= currentPage)
			);
		}
	};

	const yieldToBrowser = () =>
		new Promise<void>((resolve) => {
			if ('requestIdleCallback' in window) {
				(
					window as Window & {
						requestIdleCallback: (callback: () => void, options: { timeout: number }) => number;
					}
				).requestIdleCallback(resolve, { timeout: 50 });
			} else setTimeout(resolve, 0);
		});

	const buildTextIndex = async (documentToIndex: any, generation: number) => {
		const indexGeneration = ++textIndexGeneration;
		let indexedBytes = [...pageTextIndex.values()].reduce(
			(total, text) => total + text.length * 2,
			0
		);
		for (let pageNumber = 1; pageNumber <= documentToIndex.numPages; pageNumber++) {
			if (
				generation !== loadGeneration ||
				indexGeneration !== textIndexGeneration ||
				documentToIndex !== pdfDoc
			)
				return;
			if (pageTextIndex.has(pageNumber)) continue;
			const page = await documentToIndex.getPage(pageNumber);
			if (
				generation !== loadGeneration ||
				indexGeneration !== textIndexGeneration ||
				documentToIndex !== pdfDoc
			) {
				page.cleanup?.();
				return;
			}
			try {
				const textContent = await page.getTextContent();
				if (
					generation !== loadGeneration ||
					indexGeneration !== textIndexGeneration ||
					documentToIndex !== pdfDoc
				)
					return;
				const text = textContent.items
					.map((item: { str?: string }) => item.str ?? '')
					.join(' ')
					.toLocaleLowerCase();
				const nextIndexedBytes = indexedBytes + text.length * 2;
				if (nextIndexedBytes > maxIndexedTextBytes) return;
				indexedBytes = nextIndexedBytes;
				pageTextIndex.set(pageNumber, text);
				if (pageNumber % 4 === 0 || pageNumber === documentToIndex.numPages) {
					await yieldToBrowser();
					if (
						generation !== loadGeneration ||
						indexGeneration !== textIndexGeneration ||
						documentToIndex !== pdfDoc
					)
						return;
				}
			} finally {
				page.cleanup?.();
			}
		}
	};

	const runSearch = async () => {
		const query = searchQuery.trim();
		const queryGeneration = ++searchGeneration;
		const documentGeneration = loadGeneration;
		const documentToSearch = pdfDoc;
		textIndexGeneration += 1;
		if (!query || !documentToSearch) {
			searchResults = [];
			searchResultIndex = -1;
			searchIndexing = false;
			if (documentToSearch) void buildTextIndex(documentToSearch, documentGeneration);
			return;
		}

		const isCurrent = () =>
			queryGeneration === searchGeneration &&
			documentGeneration === loadGeneration &&
			documentToSearch === pdfDoc &&
			query === searchQuery.trim();
		searchIndexing = true;
		publishSearchResults(findMatchingPages(pageTextIndex, query));
		try {
			const result = await scanPdfText({
				pageCount: documentToSearch.numPages,
				query,
				cachedPages: pageTextIndex,
				isCurrent,
				yieldToBrowser,
				onProgress: (matches) => {
					if (isCurrent()) publishSearchResults(matches);
				},
				readPage: async (pageNumber) => {
					if (!isCurrent()) throw new DOMException('Search superseded', 'AbortError');
					const page = await documentToSearch.getPage(pageNumber);
					if (!isCurrent()) {
						page.cleanup?.();
						throw new DOMException('Search superseded', 'AbortError');
					}
					try {
						const textContent = await page.getTextContent();
						if (!isCurrent()) throw new DOMException('Search superseded', 'AbortError');
						return textContent.items.map((item: { str?: string }) => item.str ?? '').join(' ');
					} finally {
						page.cleanup?.();
					}
				}
			});
			if (isCurrent() && !result.cancelled) publishSearchResults(result.matches);
		} catch (cause) {
			if (isCurrent() && (cause as { name?: string })?.name !== 'AbortError') {
				console.error('PDF search failed:', cause);
			}
		} finally {
			if (isCurrent()) {
				searchIndexing = false;
				void buildTextIndex(documentToSearch, documentGeneration);
			}
		}
	};

	const scrollToPage = (pageNumber: number, behavior: ScrollBehavior = 'smooth') => {
		const page = sceneElement?.querySelector<HTMLElement>(`[data-page-number="${pageNumber}"]`);
		if (!page || !outerContainer) return;
		outerContainer.scrollTo({ top: page.offsetTop, behavior });
		currentPage = pageNumber;
	};

	const movePage = (change: number) => {
		if (!pdfDoc) return;
		scrollToPage(Math.max(1, Math.min(pdfDoc.numPages, currentPage + change)));
	};

	const moveSearchResult = (change: number) => {
		if (!searchResults.length) return;
		searchResultIndex = (searchResultIndex + change + searchResults.length) % searchResults.length;
		scrollToPage(searchResults[searchResultIndex]);
	};

	const handleSearchInput = () => void runSearch();

	const handleResize = () => {
		if (!pdfDoc || !outerContainer) return;
		const anchor = getPageAnchor(getPageMetrics(), outerContainer.scrollTop);
		if (resizeTimer) clearTimeout(resizeTimer);
		resizeTimer = setTimeout(() => {
			if (!pdfDoc || !outerContainer) return;
			rerenderVisiblePages(zoomLevel);
			if (resizeFrame) cancelAnimationFrame(resizeFrame);
			resizeFrame = requestAnimationFrame(() => {
				outerContainer.scrollTop = getScrollTopForPageAnchor(getPageMetrics(), anchor);
				updateCurrentPage();
			});
		}, 120);
	};

	const loadPdf = async () => {
		if (!url && !data) return;
		const generation = ++loadGeneration;
		searchGeneration += 1;
		searchIndexing = false;
		const previousAnchor = getPageAnchor(getPageMetrics(), outerContainer?.scrollTop ?? 0);
		const previousZoom = zoomLevel;
		let candidatePdfDoc: any = null;
		let previousPdfDoc: any = null;
		let previousScene: ChildNode[] = [];
		const releaseOwnedPreviousPdf = () => {
			const documentToDestroy = getOwnedPreviousPdfToDestroy(previousPdfDoc, pdfDoc);
			previousPdfDoc = null;
			void documentToDestroy?.destroy();
		};

		loading = true;
		error = '';
		try {
			const pdfjs = await import('pdfjs-dist');
			pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
			let pdfData: ArrayBuffer | Uint8Array;
			if (data) pdfData = data;
			else {
				const response = await fetch(url!, { credentials: 'include' });
				if (!response.ok) throw new Error(`HTTP ${response.status}`);
				pdfData = await response.arrayBuffer();
			}
			candidatePdfDoc = await pdfjs.getDocument({ data: pdfData }).promise;
			if (candidatePdfDoc.numPages > 1000) throw new Error('PDF exceeds the viewer page limit');
			if (generation !== loadGeneration) {
				await candidatePdfDoc.destroy();
				return;
			}

			const candidateScene = document.createElement('div');
			preparePagePlaceholders(candidatePdfDoc, candidateScene);
			previousPdfDoc = pdfDoc;
			previousScene = [...sceneElement.childNodes];
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
			outerContainer.scrollTop = getScrollTopForPageAnchor(getPageMetrics(), previousAnchor);
			updateCurrentPage();
			pageTextIndex.clear();
			searchResults = [];
			searchResultIndex = -1;
			const firstPage = sceneElement.querySelector<HTMLElement>('.pdf-page-wrapper');
			if (!firstPage || !(await renderPage(firstPage)))
				throw new Error('Failed to render PDF first page');
			if (generation !== loadGeneration) {
				releaseOwnedPreviousPdf();
				return;
			}
			observePages();
			void buildTextIndex(candidatePdfDoc, generation);
			if (searchQuery.trim()) void runSearch();
			dispatch('preview-rendered', data);
			releaseOwnedPreviousPdf();
		} catch (cause) {
			if (generation !== loadGeneration) {
				releaseOwnedPreviousPdf();
				return;
			}
			if (candidatePdfDoc && candidatePdfDoc === pdfDoc && previousPdfDoc) {
				releaseAllPages();
				pzInstance?.dispose();
				sceneElement.replaceChildren(...previousScene);
				pdfDoc = previousPdfDoc;
				previousPdfDoc = null;
				initPanzoom();
				if (previousZoom !== 1 && pzInstance) {
					pzInstance.zoomAbs(0, 0, previousZoom);
					zoomLevel = previousZoom;
				}
				outerContainer.scrollTop = getScrollTopForPageAnchor(getPageMetrics(), previousAnchor);
				observePages();
				void candidatePdfDoc.destroy();
			} else if (candidatePdfDoc && candidatePdfDoc !== pdfDoc) await candidatePdfDoc.destroy();
			console.error('PDF render error:', cause);
			error = 'Failed to load PDF.';
			if (pdfDoc && searchQuery.trim()) void runSearch();
			dispatch('preview-failed', data);
		} finally {
			if (generation === loadGeneration) loading = false;
		}
	};

	onMount(() => {
		mounted = true;
		resizeObserver = new ResizeObserver(handleResize);
		resizeObserver.observe(outerContainer);
	});

	onDestroy(() => {
		mounted = false;
		loadGeneration += 1;
		textIndexGeneration += 1;
		searchGeneration += 1;
		if (rerenderTimer) clearTimeout(rerenderTimer);
		if (resizeTimer) clearTimeout(resizeTimer);
		if (resizeFrame) cancelAnimationFrame(resizeFrame);
		resizeObserver?.disconnect();
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

	<div
		class="h-full overflow-y-auto"
		bind:this={outerContainer}
		role="region"
		aria-label={`PDF document, page ${currentPage} of ${pdfDoc?.numPages ?? 0}`}
		on:scroll={updateCurrentPage}
	>
		<div bind:this={sceneElement} class="flex w-full flex-col items-center gap-5 px-3"></div>
	</div>

	{#if !loading && pdfDoc}
		<div
			class="absolute bottom-3 left-1/2 z-30 flex -translate-x-1/2 items-center gap-0.5 rounded-lg border border-gray-200/60 bg-white/90 px-1 py-0.5 shadow-lg backdrop-blur-sm dark:border-gray-700/60 dark:bg-gray-850/90"
		>
			<div class="mr-1 flex items-center border-r border-gray-200/60 pr-1 dark:border-gray-700/60">
				<button
					class="p-1.5 text-gray-500 transition hover:bg-gray-100 disabled:opacity-40 dark:text-gray-400 dark:hover:bg-gray-800"
					on:click={() => movePage(-1)}
					aria-label="Previous page"
					disabled={currentPage <= 1}>‹</button
				>
				<span
					class="min-w-[3.8rem] text-center text-[11px] tabular-nums text-gray-700 dark:text-gray-200"
					aria-live="polite">{currentPage} / {pdfDoc.numPages}</span
				>
				<button
					class="p-1.5 text-gray-500 transition hover:bg-gray-100 disabled:opacity-40 dark:text-gray-400 dark:hover:bg-gray-800"
					on:click={() => movePage(1)}
					aria-label="Next page"
					disabled={currentPage >= pdfDoc.numPages}>›</button
				>
			</div>
			<label class="sr-only" for="pdf-search">Search this PDF</label>
			<input
				id="pdf-search"
				class="w-24 rounded-md bg-transparent px-1.5 py-1 text-[11px] text-gray-700 outline-none placeholder:text-gray-400 focus:bg-gray-100 dark:text-gray-200 dark:focus:bg-gray-800"
				bind:value={searchQuery}
				on:input={handleSearchInput}
				placeholder="Search"
				aria-label="Search this PDF"
			/>
			{#if searchQuery.trim()}
				<span class="text-[10px] tabular-nums text-gray-700 dark:text-gray-200" aria-live="polite"
					>{searchResults.length
						? `${searchResultIndex + 1}/${searchResults.length}`
						: searchIndexing
							? 'Searching…'
							: 'No match'}</span
				>
				<button
					class="p-1.5 text-gray-500 transition hover:bg-gray-100 disabled:opacity-40 dark:text-gray-400 dark:hover:bg-gray-800"
					on:click={() => moveSearchResult(-1)}
					aria-label="Previous search result"
					disabled={!searchResults.length}>⌃</button
				>
				<button
					class="mr-1 border-r border-gray-200/60 p-1.5 pr-2 text-gray-500 transition hover:bg-gray-100 disabled:opacity-40 dark:border-gray-700/60 dark:text-gray-400 dark:hover:bg-gray-800"
					on:click={() => moveSearchResult(1)}
					aria-label="Next search result"
					disabled={!searchResults.length}>⌄</button
				>
			{/if}
			<button
				class="rounded-md p-1.5 text-gray-500 transition hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
				on:click={zoomOut}
				aria-label="Zoom out">−</button
			>
			<button
				class="min-w-[3rem] rounded-md px-1.5 py-1 text-center text-[11px] tabular-nums text-gray-700 transition hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800"
				on:click={resetView}
				aria-label="Reset zoom">{Math.round(zoomLevel * 100)}%</button
			>
			<button
				class="rounded-md p-1.5 text-gray-500 transition hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
				on:click={zoomIn}
				aria-label="Zoom in">+</button
			>
		</div>
	{/if}
</div>

<style>
	:global(.textLayer) {
		position: absolute;
		inset: 0;
		overflow: clip;
		line-height: 1;
		-webkit-text-size-adjust: none;
		text-size-adjust: none;
		transform-origin: 0 0;
		z-index: 0;
		--user-unit: 1;
		--total-scale-factor: calc(var(--scale-factor) * var(--user-unit));
		--min-font-size: 1;
		--text-scale-factor: calc(var(--total-scale-factor) * var(--min-font-size));
		--min-font-size-inv: calc(1 / var(--min-font-size));
	}
	:global(.textLayer :is(span, br)) {
		color: transparent;
		position: absolute;
		white-space: pre;
		cursor: text;
		transform-origin: 0% 0%;
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
		user-select: none;
		cursor: default;
	}
	:global(.textLayer ::selection) {
		background: rgba(0, 0, 255, 0.25);
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
		user-select: none;
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
