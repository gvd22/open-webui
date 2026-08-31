<script lang="ts">
	import { createEventDispatcher, getContext, onDestroy, onMount } from 'svelte';
	import type { Writable } from 'svelte/store';
	import type { i18n as i18nType } from 'i18next';
	import Spinner from '$lib/components/common/Spinner.svelte';
	import DocumentPagination from '$lib/components/common/DocumentPagination.svelte';
	import DocumentZoomControls from '$lib/components/common/DocumentZoomControls.svelte';
	import {
		clampDocumentZoom,
		DOCUMENT_ZOOM_BUTTON_STEP,
		DOCUMENT_ZOOM_MAX,
		getDocumentWheelZoomDelta,
		panDocumentViewport
	} from '$lib/components/common/documentZoom';
	import { clampDocumentTargetPage } from '$lib/utils/documentPreview';
	import { hardenDocumentLinks, PPTX_ZIP_LIMITS, validatePptxArchive } from './security';
	const i18n: Writable<i18nType> = getContext('i18n');
	const dispatch = createEventDispatcher<{
		'preview-rendered': { data: ArrayBuffer };
		'preview-failed': { data: ArrayBuffer };
	}>();

	export let data: ArrayBuffer;
	export let targetPage: number | null = null;

	let host: HTMLDivElement;
	let viewer: import('@aiden0z/pptx-renderer').PptxViewer | null = null;
	let viewerContainer: HTMLDivElement | null = null;
	let viewerLinkObserver: MutationObserver | null = null;
	let mounted = false;
	let loading = true;
	let error = '';
	let slideCount = 0;
	let currentSlide = 0;
	let renderedData: ArrayBuffer | null = null;
	let attemptedData: ArrayBuffer | null = null;
	let renderGeneration = 0;
	let navigationGeneration = 0;
	let navigationPending = false;
	let zoomPercent = 100;
	let renderAbortController: AbortController | null = null;
	let dragStart: { x: number; y: number; scrollLeft: number; scrollTop: number } | null = null;
	let appliedTargetPage: number | null = null;

	const applyVisualZoom = () => {
		if (!viewerContainer) return;
		const scale = zoomPercent / 100;
		host.style.setProperty('--presentation-scroll-size', `${Math.max(100, zoomPercent)}%`);
		viewerContainer.style.transform = `scale(${scale})`;
		viewerContainer.style.transformOrigin = scale > 1 ? 'top left' : 'center center';
	};

	const setZoom = (value: number, anchorX?: number, anchorY?: number) => {
		if (!host) return;
		const nextZoom = clampDocumentZoom(value);
		if (nextZoom === zoomPercent) return;

		const oldScale = zoomPercent / 100;
		const nextScale = nextZoom / 100;
		const x = anchorX ?? host.clientWidth / 2;
		const y = anchorY ?? host.clientHeight / 2;
		const contentX = (host.scrollLeft + x) / oldScale;
		const contentY = (host.scrollTop + y) / oldScale;

		zoomPercent = nextZoom;
		applyVisualZoom();
		requestAnimationFrame(() => {
			if (nextScale <= 1) {
				host.scrollTo(0, 0);
				return;
			}
			host.scrollTo(contentX * nextScale - x, contentY * nextScale - y);
		});
	};

	const handleDocumentWheel = (event: WheelEvent) => {
		if (!event.ctrlKey && !event.metaKey) {
			if (zoomPercent <= 100) return;
			event.preventDefault();
			panDocumentViewport(host, event.deltaX, event.deltaY);
			return;
		}
		event.preventDefault();
		const rect = host.getBoundingClientRect();
		const step = getDocumentWheelZoomDelta(event.deltaY);
		if (step === 0) return;
		setZoom(zoomPercent + step, event.clientX - rect.left, event.clientY - rect.top);
	};

	const resetZoom = () => setZoom(100);

	const startDrag = (event: PointerEvent) => {
		if (event.button !== 0 || zoomPercent <= 100) return;
		host.setPointerCapture(event.pointerId);
		dragStart = {
			x: event.clientX,
			y: event.clientY,
			scrollLeft: host.scrollLeft,
			scrollTop: host.scrollTop
		};
	};

	const dragPresentation = (event: PointerEvent) => {
		if (!dragStart) return;
		host.scrollLeft = dragStart.scrollLeft - (event.clientX - dragStart.x);
		host.scrollTop = dragStart.scrollTop - (event.clientY - dragStart.y);
	};

	const stopDrag = (event: PointerEvent) => {
		if (!dragStart) return;
		dragStart = null;
		if (host.hasPointerCapture(event.pointerId)) host.releasePointerCapture(event.pointerId);
	};

	const loadPresentation = async () => {
		if (!mounted || !host || data === attemptedData) return;
		const generation = ++renderGeneration;
		navigationGeneration += 1;
		navigationPending = false;
		renderAbortController?.abort();
		const abortController = new AbortController();
		renderAbortController = abortController;
		const retainedSlide = currentSlide;
		const candidateData = data;
		attemptedData = candidateData;
		loading = true;
		error = '';
		let candidateViewer: import('@aiden0z/pptx-renderer').PptxViewer | null = null;
		const candidateContainer = document.createElement('div');
		const candidateLinkObserver = new MutationObserver(() =>
			hardenDocumentLinks(candidateContainer)
		);
		candidateLinkObserver.observe(candidateContainer, { childList: true, subtree: true });
		candidateContainer.className = 'presentation-render-surface';
		candidateContainer.setAttribute('aria-hidden', 'true');
		candidateContainer.inert = true;
		candidateContainer.style.pointerEvents = 'none';
		candidateContainer.style.transform = 'translateX(-200vw)';
		candidateContainer.style.visibility = 'hidden';
		host.appendChild(candidateContainer);

		try {
			await validatePptxArchive(candidateData);
			if (generation !== renderGeneration) {
				candidateLinkObserver.disconnect();
				candidateContainer.remove();
				return;
			}
			const { PptxViewer } = await import('@aiden0z/pptx-renderer');
			if (generation !== renderGeneration) {
				candidateLinkObserver.disconnect();
				candidateContainer.remove();
				return;
			}
			candidateViewer = await PptxViewer.open(candidateData, candidateContainer, {
				renderMode: 'slide',
				fitMode: 'contain',
				zipLimits: PPTX_ZIP_LIMITS,
				signal: abortController.signal,
				lazySlides: true,
				lazyMedia: true,
				pdfjs: false,
				onSlideChange: (index) => {
					if (candidateViewer === viewer && generation === renderGeneration) currentSlide = index;
				}
			});
			if (generation !== renderGeneration) {
				candidateViewer.destroy();
				candidateLinkObserver.disconnect();
				candidateContainer.remove();
				return;
			}
			hardenDocumentLinks(candidateContainer);
			const candidateSlideCount = candidateViewer.slideCount;
			const requestedPage = clampDocumentTargetPage(targetPage, candidateSlideCount);
			if (requestedPage) {
				await candidateViewer.goToSlide(requestedPage - 1);
			} else if (retainedSlide > 0 && candidateSlideCount > 1) {
				await candidateViewer.goToSlide(Math.min(retainedSlide, candidateSlideCount - 1));
			}
			if (generation !== renderGeneration) {
				candidateViewer.destroy();
				candidateLinkObserver.disconnect();
				candidateContainer.remove();
				return;
			}

			const previousViewer = viewer;
			const previousContainer = viewerContainer;
			const previousLinkObserver = viewerLinkObserver;
			viewer = candidateViewer;
			viewerContainer = candidateContainer;
			viewerLinkObserver = candidateLinkObserver;
			candidateContainer.removeAttribute('aria-hidden');
			candidateContainer.inert = false;
			candidateContainer.style.pointerEvents = '';
			candidateContainer.style.transform = '';
			candidateContainer.style.visibility = 'visible';
			applyVisualZoom();
			previousViewer?.destroy();
			previousLinkObserver?.disconnect();
			previousContainer?.remove();
			slideCount = candidateSlideCount;
			currentSlide = candidateViewer.currentSlideIndex;
			appliedTargetPage = requestedPage;
			renderedData = candidateData;
			dispatch('preview-rendered', { data: candidateData });
		} catch (cause) {
			candidateViewer?.destroy();
			candidateLinkObserver.disconnect();
			candidateContainer.remove();
			if (generation !== renderGeneration) return;
			console.error('PPTX render failed:', cause);
			error = $i18n.t('This PowerPoint presentation could not be displayed.');
			dispatch('preview-failed', { data: candidateData });
		} finally {
			if (generation === renderGeneration) loading = false;
		}
	};

	const goToSlide = async (index: number) => {
		const activeViewer = viewer;
		const generation = renderGeneration;
		if (!mounted || !activeViewer || navigationPending) return;
		const navigation = ++navigationGeneration;
		navigationPending = true;

		try {
			await activeViewer.goToSlide(Math.max(0, Math.min(slideCount - 1, index)));
		} catch (cause) {
			if (
				mounted &&
				viewer === activeViewer &&
				generation === renderGeneration &&
				navigation === navigationGeneration
			) {
				console.error('PowerPoint slide navigation failed:', cause);
			}
			return;
		} finally {
			if (
				mounted &&
				viewer === activeViewer &&
				generation === renderGeneration &&
				navigation === navigationGeneration
			) {
				navigationPending = false;
			}
		}

		if (
			!mounted ||
			viewer !== activeViewer ||
			generation !== renderGeneration ||
			navigation !== navigationGeneration
		) {
			return;
		}

		currentSlide = activeViewer.currentSlideIndex;
	};

	const changeSlide = async (direction: -1 | 1) => {
		const next = Math.max(0, Math.min(slideCount - 1, currentSlide + direction));
		if (next === currentSlide) return;
		await goToSlide(next);
	};

	const handlePresentationKeydown = (event: KeyboardEvent) => {
		if (event.altKey || event.ctrlKey || event.metaKey) {
			return;
		}
		switch (event.key) {
			case 'ArrowLeft':
			case 'PageUp':
				event.preventDefault();
				void changeSlide(-1);
				break;
			case 'ArrowRight':
			case 'PageDown':
				event.preventDefault();
				void changeSlide(1);
				break;
			case 'Home':
				event.preventDefault();
				void goToSlide(0);
				break;
			case 'End':
				event.preventDefault();
				void goToSlide(slideCount - 1);
				break;
		}
	};

	onMount(() => {
		mounted = true;
	});

	onDestroy(() => {
		mounted = false;
		renderGeneration += 1;
		navigationGeneration += 1;
		navigationPending = false;
		renderAbortController?.abort();
		viewer?.destroy();
		viewerLinkObserver?.disconnect();
		viewerContainer?.remove();
		viewer = null;
		viewerContainer = null;
		viewerLinkObserver = null;
	});

	$: if (mounted && data !== attemptedData) void loadPresentation();
	$: if (!targetPage) appliedTargetPage = null;
	$: if (mounted && viewer && targetPage && targetPage !== appliedTargetPage) {
		appliedTargetPage = targetPage;
		void goToSlide((clampDocumentTargetPage(targetPage, slideCount) ?? 1) - 1);
	}
</script>

<div
	class="presentation-stage relative flex h-full min-h-0 items-center justify-center overflow-hidden px-5 pb-24 pt-14 sm:px-10 sm:pb-28"
>
	<div
		bind:this={host}
		role="slider"
		tabindex={slideCount > 0 ? 0 : -1}
		aria-disabled={slideCount === 0 || navigationPending}
		aria-label={$i18n.t('PowerPoint presentation')}
		aria-valuemin="1"
		aria-valuemax={Math.max(1, slideCount)}
		aria-valuenow={Math.min(Math.max(1, currentSlide + 1), Math.max(1, slideCount))}
		aria-valuetext={$i18n.t('Slide {{current}} of {{total}}', {
			current: Math.min(Math.max(1, currentSlide + 1), Math.max(1, slideCount)),
			total: Math.max(1, slideCount)
		})}
		aria-keyshortcuts="ArrowLeft ArrowRight PageUp PageDown Home End"
		class="presentation-container relative h-full w-full overflow-auto {zoomPercent > 100
			? 'cursor-grab select-none active:cursor-grabbing'
			: ''}"
		data-testid="powerpoint-document-viewport"
		on:keydown={handlePresentationKeydown}
		on:wheel|nonpassive={handleDocumentWheel}
		on:pointerdown={startDrag}
		on:pointermove={dragPresentation}
		on:pointerup={stopDrag}
		on:pointercancel={stopDrag}
	></div>

	{#if loading && !renderedData}
		<div
			class="absolute inset-0 flex items-center justify-center bg-white/55 backdrop-blur-[1px] dark:bg-gray-900/45"
		>
			<Spinner className="size-5" />
			<span class="sr-only" role="status">{$i18n.t('Loading')}</span>
		</div>
	{:else if loading}
		<div
			role="status"
			aria-label={$i18n.t('Updating presentation preview')}
			class="absolute right-4 top-3 z-30 rounded-full bg-white/90 p-2 shadow-sm dark:bg-gray-850/90"
		>
			<Spinner className="size-4" />
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
			class="absolute bottom-20 left-1/2 z-30 -translate-x-1/2 rounded-full bg-red-50 px-3 py-1.5 text-xs text-red-700 shadow-sm dark:bg-red-950/90 dark:text-red-200"
		>
			{$i18n.t('The latest update could not be displayed. Showing the previous version.')}
		</div>
	{:else if slideCount > 0}
		<div class="absolute bottom-5 left-1/2 z-20 -translate-x-1/2 sm:bottom-7">
			<DocumentPagination
				current={currentSlide + 1}
				total={slideCount}
				pending={navigationPending}
				previousLabel={$i18n.t('Previous slide')}
				nextLabel={$i18n.t('Next slide')}
				onPrevious={() => void changeSlide(-1)}
				onNext={() => void changeSlide(1)}
			>
				<DocumentZoomControls
					percent={zoomPercent}
					maximum={DOCUMENT_ZOOM_MAX}
					zoomOutLabel={$i18n.t('Zoom out')}
					resetLabel={$i18n.t('Reset zoom')}
					zoomInLabel={$i18n.t('Zoom in')}
					onZoomOut={() => setZoom(zoomPercent - DOCUMENT_ZOOM_BUTTON_STEP)}
					onReset={resetZoom}
					onZoomIn={() => setZoom(zoomPercent + DOCUMENT_ZOOM_BUTTON_STEP)}
				/>
			</DocumentPagination>
		</div>
	{/if}
</div>

<style>
	.presentation-stage {
		background: #f7f6f3;
	}

	:global(.dark .presentation-stage) {
		background: #151517;
	}

	:global(.presentation-render-surface) {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	:global(.presentation-render-surface > *) {
		max-height: 100%;
		max-width: 100%;
		box-shadow: 0 22px 58px rgba(30, 28, 25, 0.18);
	}

	.presentation-container::before {
		content: '';
		position: absolute;
		left: 0;
		top: 0;
		width: var(--presentation-scroll-size, 100%);
		height: var(--presentation-scroll-size, 100%);
		pointer-events: none;
	}
</style>
