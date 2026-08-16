<script lang="ts">
	import { createEventDispatcher, getContext, onDestroy, onMount } from 'svelte';
	import Spinner from '$lib/components/common/Spinner.svelte';
	import ChevronLeft from '$lib/components/icons/ChevronLeft.svelte';
	import ChevronRight from '$lib/components/icons/ChevronRight.svelte';
	import { hardenDocumentLinks, PPTX_ZIP_LIMITS, validatePptxArchive } from './security';
	const i18n = getContext('i18n');
	const dispatch = createEventDispatcher<{
		'preview-rendered': { data: ArrayBuffer };
		'preview-failed': { data: ArrayBuffer };
	}>();

	export let data: ArrayBuffer;

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
	let renderAbortController: AbortController | null = null;

	const loadPresentation = async () => {
		if (!mounted || !host || data === attemptedData) return;
		const generation = ++renderGeneration;
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
			if (retainedSlide > 0 && candidateSlideCount > 1) {
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
			previousViewer?.destroy();
			previousLinkObserver?.disconnect();
			previousContainer?.remove();
			slideCount = candidateSlideCount;
			currentSlide = candidateViewer.currentSlideIndex;
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

	const changeSlide = async (direction: -1 | 1) => {
		if (!viewer) return;
		const next = Math.max(0, Math.min(slideCount - 1, currentSlide + direction));
		if (next === currentSlide) return;
		await viewer.goToSlide(next);
		currentSlide = viewer.currentSlideIndex;
	};

	const goToSlide = async (index: number) => {
		if (!viewer) return;
		await viewer.goToSlide(Math.max(0, Math.min(slideCount - 1, index)));
		currentSlide = viewer.currentSlideIndex;
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
		renderAbortController?.abort();
		viewer?.destroy();
		viewerLinkObserver?.disconnect();
		viewerContainer?.remove();
		viewer = null;
		viewerContainer = null;
		viewerLinkObserver = null;
	});

	$: if (mounted && data !== attemptedData) void loadPresentation();
</script>

<div
	class="presentation-stage relative flex h-full min-h-0 items-center justify-center overflow-hidden px-5 pb-24 pt-14 sm:px-10 sm:pb-28"
>
	<div
		bind:this={host}
		role="slider"
		tabindex={slideCount > 0 ? 0 : -1}
		aria-disabled={slideCount === 0}
		aria-label={$i18n.t('PowerPoint presentation')}
		aria-valuemin="1"
		aria-valuemax={Math.max(1, slideCount)}
		aria-valuenow={Math.min(Math.max(1, currentSlide + 1), Math.max(1, slideCount))}
		aria-valuetext={$i18n.t('Slide {{current}} of {{total}}', {
			current: Math.min(Math.max(1, currentSlide + 1), Math.max(1, slideCount)),
			total: Math.max(1, slideCount)
		})}
		aria-keyshortcuts="ArrowLeft ArrowRight PageUp PageDown Home End"
		class="presentation-container relative h-full w-full"
		data-testid="powerpoint-document-viewport"
		on:keydown={handlePresentationKeydown}
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
		<div
			class="slide-controls absolute bottom-5 left-1/2 z-20 flex -translate-x-1/2 items-center gap-2 rounded-full px-2 py-1.5 text-white shadow-2xl sm:bottom-7"
		>
			<button
				type="button"
				class="flex size-9 items-center justify-center rounded-full transition hover:bg-white/10 disabled:opacity-35"
				disabled={currentSlide === 0}
				aria-label={$i18n.t('Previous slide')}
				on:click={() => void changeSlide(-1)}
			>
				<ChevronLeft className="size-5" />
			</button>
			<div
				aria-live="polite"
				class="min-w-[4.75rem] text-center text-sm font-semibold tabular-nums"
			>
				{currentSlide + 1} / {slideCount}
			</div>
			<button
				type="button"
				class="flex size-9 items-center justify-center rounded-full transition hover:bg-white/10 disabled:opacity-35"
				disabled={currentSlide >= slideCount - 1}
				aria-label={$i18n.t('Next slide')}
				on:click={() => void changeSlide(1)}
			>
				<ChevronRight className="size-5" />
			</button>
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

	.slide-controls {
		background: rgba(52, 49, 46, 0.88);
		backdrop-filter: blur(18px);
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
</style>
