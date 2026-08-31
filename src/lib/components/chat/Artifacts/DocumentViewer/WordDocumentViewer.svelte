<script lang="ts">
	import { createEventDispatcher, getContext, onDestroy, onMount, tick } from 'svelte';
	import type { Writable } from 'svelte/store';
	import type { i18n as i18nType } from 'i18next';
	import Spinner from '$lib/components/common/Spinner.svelte';
	import DocumentZoomToolbar from '$lib/components/common/DocumentZoomToolbar.svelte';
	import {
		clampDocumentZoom,
		DOCUMENT_ZOOM_BUTTON_STEP,
		DOCUMENT_ZOOM_MAX,
		getDocumentWheelZoomDelta,
		panDocumentViewport
	} from '$lib/components/common/documentZoom';
	import { clampDocumentTargetPage } from '$lib/utils/documentPreview';
	import { hardenDocumentLinks, validateDocxArchive } from './security';
	const i18n: Writable<i18nType> = getContext('i18n');
	const dispatch = createEventDispatcher<{
		'preview-rendered': { data: ArrayBuffer };
		'preview-failed': { data: ArrayBuffer };
	}>();

	export let data: ArrayBuffer;
	export let targetPage: number | null = null;

	let viewport: HTMLDivElement;
	let documentRoot: HTMLDivElement;
	let mounted = false;
	let rendering = false;
	let error = '';
	let renderedData: ArrayBuffer | null = null;
	let attemptedData: ArrayBuffer | null = null;
	let renderGeneration = 0;
	let fitScale = 1;
	let zoomPercent = 100;
	let resizeObserver: ResizeObserver | null = null;
	let resizeFrame = 0;
	let dragStart: { x: number; y: number; scrollLeft: number; scrollTop: number } | null = null;
	let appliedTargetPage: number | null = null;
	let appliedTargetData: ArrayBuffer | null = null;

	const fitDocumentToViewport = () => {
		const pages = Array.from(
			documentRoot?.querySelectorAll<HTMLElement>('section.koby-docx') ?? []
		);
		if (!viewport || pages.length === 0) return;
		const viewportStyle = getComputedStyle(viewport);
		const availableWidth =
			viewport.clientWidth -
			parseFloat(viewportStyle.paddingLeft) -
			parseFloat(viewportStyle.paddingRight);
		const widestPage = Math.max(
			...pages.map(
				(page) =>
					page.getBoundingClientRect().width / Math.max(fitScale * (zoomPercent / 100), 0.01)
			)
		);
		fitScale = Math.min(1, availableWidth / widestPage);
	};

	const setZoom = (value: number, anchorX?: number, anchorY?: number) => {
		if (!viewport) return;
		const nextZoom = clampDocumentZoom(value);
		if (nextZoom === zoomPercent) return;
		const oldScale = fitScale * (zoomPercent / 100);
		const nextScale = fitScale * (nextZoom / 100);
		const x = anchorX ?? viewport.clientWidth / 2;
		const y = anchorY ?? viewport.clientHeight / 2;
		const contentX = (viewport.scrollLeft + x) / oldScale;
		const contentY = (viewport.scrollTop + y) / oldScale;
		zoomPercent = nextZoom;
		requestAnimationFrame(() => {
			viewport.scrollTo(contentX * nextScale - x, contentY * nextScale - y);
		});
	};

	const handleDocumentWheel = (event: WheelEvent) => {
		if (!event.ctrlKey && !event.metaKey) {
			if (zoomPercent <= 100) return;
			event.preventDefault();
			panDocumentViewport(viewport, event.deltaX, event.deltaY);
			return;
		}
		event.preventDefault();
		const rect = viewport.getBoundingClientRect();
		setZoom(
			zoomPercent + getDocumentWheelZoomDelta(event.deltaY),
			event.clientX - rect.left,
			event.clientY - rect.top
		);
	};

	const startDrag = (event: PointerEvent) => {
		if (event.button !== 0 || zoomPercent <= 100) return;
		viewport.setPointerCapture(event.pointerId);
		dragStart = {
			x: event.clientX,
			y: event.clientY,
			scrollLeft: viewport.scrollLeft,
			scrollTop: viewport.scrollTop
		};
	};

	const dragDocument = (event: PointerEvent) => {
		if (!dragStart) return;
		viewport.scrollLeft = dragStart.scrollLeft - (event.clientX - dragStart.x);
		viewport.scrollTop = dragStart.scrollTop - (event.clientY - dragStart.y);
	};

	const stopDrag = (event: PointerEvent) => {
		if (!dragStart) return;
		dragStart = null;
		if (viewport.hasPointerCapture(event.pointerId))
			viewport.releasePointerCapture(event.pointerId);
	};

	const scheduleFitToWidth = () => {
		cancelAnimationFrame(resizeFrame);
		resizeFrame = requestAnimationFrame(fitDocumentToViewport);
	};

	const scrollToTargetPage = async () => {
		if (!viewport || !documentRoot || !renderedData) return;
		const pages = Array.from(documentRoot.querySelectorAll<HTMLElement>('section.koby-docx'));
		const page = clampDocumentTargetPage(targetPage, pages.length);
		if (!page || (page === appliedTargetPage && renderedData === appliedTargetData)) return;

		await tick();
		const target = pages[page - 1];
		if (!target) return;
		viewport.scrollTo({ top: target.offsetTop, behavior: 'auto' });
		appliedTargetPage = page;
		appliedTargetData = renderedData;
	};

	const renderDocument = async () => {
		if (!mounted || !documentRoot || data === renderedData) return;
		const generation = ++renderGeneration;
		const previousScrollTop = viewport?.scrollTop ?? 0;
		const candidateData = data;
		attemptedData = candidateData;
		rendering = true;
		error = '';

		try {
			await validateDocxArchive(candidateData);
			if (generation !== renderGeneration) return;
			const { renderAsync } = await import('docx-preview');
			if (generation !== renderGeneration) return;
			const stagingRoot = document.createElement('div');
			await renderAsync(candidateData, stagingRoot, stagingRoot, {
				className: 'koby-docx',
				inWrapper: true,
				breakPages: true,
				ignoreLastRenderedPageBreak: false,
				renderHeaders: true,
				renderFooters: true,
				renderFootnotes: true,
				renderEndnotes: true,
				renderComments: false,
				renderChanges: false,
				renderAltChunks: false,
				useBase64URL: true,
				experimental: false,
				debug: false
			});
			if (generation !== renderGeneration) return;
			hardenDocumentLinks(stagingRoot);
			documentRoot.replaceChildren(...stagingRoot.childNodes);
			renderedData = candidateData;
			await tick();
			if (generation !== renderGeneration) return;
			if (viewport) viewport.scrollTop = previousScrollTop;
			fitDocumentToViewport();
			await scrollToTargetPage();
			dispatch('preview-rendered', { data: candidateData });
		} catch (cause) {
			if (generation !== renderGeneration) return;
			console.error('DOCX render failed:', cause);
			error = $i18n.t('This Word document could not be displayed.');
			dispatch('preview-failed', { data: candidateData });
		} finally {
			if (generation === renderGeneration) rendering = false;
		}
	};

	onMount(() => {
		mounted = true;
		resizeObserver = new ResizeObserver(scheduleFitToWidth);
		resizeObserver.observe(viewport);
	});

	onDestroy(() => {
		mounted = false;
		renderGeneration += 1;
		resizeObserver?.disconnect();
		cancelAnimationFrame(resizeFrame);
	});

	$: if (mounted && data !== attemptedData) void renderDocument();
	$: if (!targetPage) {
		appliedTargetPage = null;
		appliedTargetData = null;
	}
	$: if (mounted && renderedData && targetPage) void scrollToTargetPage();
</script>

<div class="relative h-full min-h-0 overflow-hidden">
	<div
		bind:this={viewport}
		class="word-viewport h-full overflow-auto px-5 pb-20 pt-12 sm:px-8 {zoomPercent > 100
			? 'cursor-grab select-none active:cursor-grabbing'
			: ''}"
		data-testid="word-document-viewport"
		role="region"
		aria-label={$i18n.t('Word document')}
		on:wheel|nonpassive={handleDocumentWheel}
		on:pointerdown={startDrag}
		on:pointermove={dragDocument}
		on:pointerup={stopDrag}
		on:pointercancel={stopDrag}
	>
		<div
			bind:this={documentRoot}
			class="mx-auto min-h-full min-w-0"
			style:--docx-scale={fitScale * (zoomPercent / 100)}
		></div>
	</div>

	{#if renderedData}
		<div class="absolute bottom-3 left-1/2 z-20 -translate-x-1/2">
			<DocumentZoomToolbar
				percent={zoomPercent}
				maximum={DOCUMENT_ZOOM_MAX}
				zoomOutLabel={$i18n.t('Zoom out')}
				resetLabel={$i18n.t('Reset zoom')}
				zoomInLabel={$i18n.t('Zoom in')}
				onZoomOut={() => setZoom(zoomPercent - DOCUMENT_ZOOM_BUTTON_STEP)}
				onReset={() => setZoom(100)}
				onZoomIn={() => setZoom(zoomPercent + DOCUMENT_ZOOM_BUTTON_STEP)}
			/>
		</div>
	{/if}

	{#if rendering}
		<div
			class="pointer-events-none absolute right-4 top-3 rounded-full bg-white/90 p-2 shadow-sm dark:bg-gray-850/90"
		>
			<Spinner className="size-3.5" />
			<span class="sr-only" role="status">{$i18n.t('Loading')}</span>
		</div>
	{:else if error && !renderedData}
		<div
			role="alert"
			class="absolute inset-0 flex items-center justify-center p-8 text-center text-sm text-gray-500 dark:text-gray-400"
		>
			{error}
		</div>
	{:else if error}
		<div
			role="alert"
			class="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-red-50 px-3 py-1.5 text-xs text-red-700 shadow-sm dark:bg-red-950/90 dark:text-red-200"
		>
			{$i18n.t('The latest update could not be displayed. Showing the previous version.')}
		</div>
	{/if}
</div>

<style>
	.word-viewport {
		background: #f5f4f1;
	}

	:global(.dark .word-viewport) {
		background: #171719;
	}

	:global(.koby-docx-wrapper) {
		background: transparent !important;
		padding: 0 !important;
	}

	:global(section.koby-docx) {
		margin: 0 auto 20px !important;
		zoom: var(--docx-scale, 1);
		box-shadow: 0 18px 46px rgba(25, 24, 22, 0.12) !important;
		border-radius: 3px;
		overflow: hidden;
	}

	:global(.dark section.koby-docx) {
		box-shadow: 0 18px 52px rgba(0, 0, 0, 0.4) !important;
	}

	/* Word stores common bullets as a private Symbol-font glyph. Use a web-safe marker. */
	:global(section.koby-docx p[class*='_listbullet']::before) {
		content: '•\9 ' !important;
		font-family: Arial, sans-serif !important;
	}
</style>
