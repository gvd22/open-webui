<script lang="ts">
	import { getContext, onDestroy, onMount, tick } from 'svelte';
	import Spinner from '$lib/components/common/Spinner.svelte';
	import { hardenDocumentLinks, validateDocxArchive } from './security';
	const i18n = getContext('i18n');

	export let data: ArrayBuffer;

	let viewport: HTMLDivElement;
	let documentRoot: HTMLDivElement;
	let mounted = false;
	let rendering = false;
	let error = '';
	let renderedData: ArrayBuffer | null = null;
	let attemptedData: ArrayBuffer | null = null;
	let renderGeneration = 0;

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
			if (viewport) viewport.scrollTop = previousScrollTop;
		} catch (cause) {
			if (generation !== renderGeneration) return;
			console.error('DOCX render failed:', cause);
			error = $i18n.t('This Word document could not be displayed.');
		} finally {
			if (generation === renderGeneration) rendering = false;
		}
	};

	onMount(() => {
		mounted = true;
	});

	onDestroy(() => {
		mounted = false;
		renderGeneration += 1;
	});

	$: if (mounted && data !== attemptedData) void renderDocument();
</script>

<div class="relative h-full min-h-0 overflow-hidden">
	<div
		bind:this={viewport}
		class="word-viewport h-full overflow-auto px-5 pb-20 pt-12 sm:px-8"
		data-testid="word-document-viewport"
	>
		<div bind:this={documentRoot} class="mx-auto min-h-full"></div>
	</div>

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

	@media (max-width: 640px) {
		:global(section.koby-docx) {
			transform-origin: top center;
		}
	}
</style>
