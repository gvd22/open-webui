<script lang="ts">
	import { createEventDispatcher, getContext, onDestroy, onMount } from 'svelte';
	import type { Readable } from 'svelte/store';
	import DocxPreview from './DocxPreview.svelte';
	import PptxPreview from './PptxPreview.svelte';
	import Spinner from './Spinner.svelte';
	import { validatePptxArchive, validateSpreadsheetArchive } from './documentSecurity';

	type OfficeDocumentFormat = 'docx' | 'pptx' | 'xls' | 'xlsx' | 'csv';

	type I18n = { t: (key: string, values?: Record<string, unknown>) => string };
	const i18n = getContext<Readable<I18n>>('i18n');
	const dispatch = createEventDispatcher<{
		'preview-rendered': { data: ArrayBuffer };
		'preview-failed': { data: ArrayBuffer };
	}>();

	export let data: ArrayBuffer | null = null;
	export let format: OfficeDocumentFormat;
	export let targetPage: number | null = null;
	export let className = '';

	let mounted = false;
	let generation = 0;
	let attemptedData: ArrayBuffer | null = null;
	let attemptedFormat: OfficeDocumentFormat | null = null;
	let docxData: ArrayBuffer | null = null;
	let slides: string[] = [];
	let currentSlide = 0;
	let workbook: import('xlsx').WorkBook | null = null;
	let sheetNames: string[] = [];
	let selectedSheet = '';
	let sheetHtml = '';
	let loading = false;
	let error = '';

	const clear = () => {
		docxData = null;
		slides = [];
		currentSlide = 0;
		workbook = null;
		sheetNames = [];
		selectedSheet = '';
		sheetHtml = '';
		error = '';
	};

	const renderSheet = async (sheet: string, currentGeneration = generation) => {
		if (!workbook?.Sheets[sheet]) return;
		const { excelToTable } = await import('$lib/utils/excelToTable');
		const result = await excelToTable(workbook.Sheets[sheet]);
		if (currentGeneration !== generation) return;
		selectedSheet = sheet;
		sheetHtml = result.html;
	};

	const load = async (candidate: ArrayBuffer, candidateFormat: OfficeDocumentFormat) => {
		const currentGeneration = ++generation;
		clear();
		loading = true;

		try {
			if (candidateFormat === 'docx') {
				docxData = candidate;
				return;
			}

			if (candidateFormat === 'pptx') {
				await validatePptxArchive(candidate);
				const { pptxToImages } = await import('$lib/utils/pptxToHtml');
				const result = await pptxToImages(candidate.slice(0));
				if (currentGeneration !== generation) return;
				slides = result.images;
				if (slides.length === 0) throw new Error('Presentation contains no slides');
				dispatch('preview-rendered', { data: candidate });
				return;
			}

			if (candidateFormat === 'xlsx') await validateSpreadsheetArchive(candidate);
			const XLSX = await import('xlsx');
			workbook = XLSX.read(new Uint8Array(candidate), { type: 'array' });
			if (currentGeneration !== generation) return;
			sheetNames = workbook.SheetNames;
			if (sheetNames.length === 0) throw new Error('Workbook contains no sheets');
			await renderSheet(sheetNames[0], currentGeneration);
			if (currentGeneration !== generation) return;
			dispatch('preview-rendered', { data: candidate });
		} catch (cause) {
			if (currentGeneration !== generation) return;
			console.error('Office document render failed:', cause);
			error = $i18n.t('This document could not be opened.');
			dispatch('preview-failed', { data: candidate });
		} finally {
			if (currentGeneration === generation && candidateFormat !== 'docx') loading = false;
		}
	};

	const handleDocxRendered = (event: CustomEvent<{ data: ArrayBuffer }>) => {
		loading = false;
		dispatch('preview-rendered', event.detail);
	};

	const handleDocxFailed = (event: CustomEvent<{ data: ArrayBuffer }>) => {
		loading = false;
		dispatch('preview-failed', event.detail);
	};

	$: if (mounted && data && (data !== attemptedData || format !== attemptedFormat)) {
		attemptedData = data;
		attemptedFormat = format;
		void load(data, format);
	}

	onMount(() => {
		mounted = true;
	});

	onDestroy(() => {
		mounted = false;
		generation += 1;
	});
</script>

<div class="relative h-full min-h-0 {className}">
	{#if docxData}
		<DocxPreview
			data={docxData}
			{targetPage}
			className="h-full w-full"
			on:preview-rendered={handleDocxRendered}
			on:preview-failed={handleDocxFailed}
		/>
	{:else if slides.length > 0}
		<PptxPreview {slides} bind:currentSlide {targetPage} className="h-full w-full" />
	{:else if workbook && sheetHtml}
		<div class="flex h-full min-h-0 flex-col">
			<div class="office-preview min-h-0 flex-1 overflow-auto">
				{@html sheetHtml}
			</div>
			{#if sheetNames.length > 1}
				<div
					class="flex shrink-0 items-center gap-1 overflow-x-auto border-t border-gray-100 px-3 py-1.5 dark:border-gray-800"
				>
					{#each sheetNames as sheet}
						<button
							type="button"
							class="shrink-0 rounded-md px-3 py-1 text-xs transition-colors {selectedSheet ===
							sheet
								? 'bg-gray-200 text-gray-800 dark:bg-gray-700 dark:text-gray-200'
								: 'text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800'}"
							on:click={() => void renderSheet(sheet)}
						>
							{sheet}
						</button>
					{/each}
				</div>
			{/if}
		</div>
	{/if}

	{#if loading && !docxData}
		<div class="absolute inset-0 flex items-center justify-center">
			<Spinner className="size-5" />
			<span class="sr-only" role="status">{$i18n.t('Loading')}</span>
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
	:global(.office-preview) {
		padding: 1rem;
		background: white;
		color: #1f2937;
	}
	:global(.dark .office-preview) {
		background: #111827;
		color: #e5e7eb;
	}
	:global(.office-preview table) {
		width: max-content;
		min-width: 100%;
		border-collapse: collapse;
		font-size: 0.75rem;
	}
	:global(.office-preview table td),
	:global(.office-preview table th) {
		min-width: 5rem;
		border: 1px solid rgba(128, 128, 128, 0.2);
		padding: 0.35rem 0.55rem;
		white-space: nowrap;
	}
	:global(.office-preview table th.excel-col-hdr),
	:global(.office-preview .excel-row-num) {
		position: sticky;
		z-index: 1;
		background: #f3f4f6;
		color: #6b7280;
		font-weight: 500;
		text-align: center;
	}
	:global(.office-preview table th.excel-col-hdr) {
		top: 0;
	}
	:global(.office-preview .excel-row-num) {
		left: 0;
		min-width: 3rem;
	}
	:global(.dark .office-preview table th.excel-col-hdr),
	:global(.dark .office-preview .excel-row-num) {
		background: #1f2937;
		color: #9ca3af;
	}
	:global(.office-preview .excel-num) {
		text-align: right;
		font-variant-numeric: tabular-nums;
	}
</style>
