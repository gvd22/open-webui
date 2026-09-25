<script lang="ts">
	import { getContext } from 'svelte';
	import Document from '$lib/components/icons/Document.svelte';
	import GlobeAlt from '$lib/components/icons/GlobeAlt.svelte';
	import Spinner from '$lib/components/common/Spinner.svelte';
	const i18n = getContext<any>('i18n');
	export let name = '';
	export let kind: 'canvas' | 'web-preview' = 'canvas';
	export let title = '';
	export let done = false;
	export let error = '';
	export let canOpen = false;
	export let onOpen: () => unknown = () => {};
	const operations: Record<string, [string, string]> = {
		canvas_create_document: ['Creating document...', 'Created'],
		web_preview_create: ['Creating document...', 'Created'],
		canvas_update_document: ['Updating document...', 'Updated'],
		canvas_replace_text: ['Updating document...', 'Updated'],
		web_preview_update: ['Updating document...', 'Updated'],
		web_preview_replace_text: ['Updating document...', 'Updated'],
		canvas_select_document: ['Opening document...', 'Document opened'],
		web_preview_select: ['Opening document...', 'Document opened'],
		canvas_read_document: ['Reading document...', 'Document read'],
		web_preview_read_file: ['Reading document...', 'Document read'],
		canvas_list_documents: ['Checking documents...', 'Documents checked'],
		web_preview_list: ['Checking documents...', 'Documents checked'],
		web_preview_import_runtime_file: ['Importing data...', 'Data imported']
	};
	$: labels = operations[name] ?? ['Loading...', 'Done'];
	$: status = error
		? $i18n.t('Operation failed', { fallbackLng: false, defaultValue: $i18n.t('Error') })
		: $i18n.t(labels[done ? 1 : 0], {
				fallbackLng: false,
				defaultValue: $i18n.t(done ? 'Done' : 'Loading...')
			});
	$: documentTitle = title || $i18n.t(kind === 'canvas' ? 'Canvas' : 'Web preview');
	$: clickable = canOpen && done && !error;
</script>

<div
	class="my-0.5 me-1.5 inline-flex max-w-full flex-col align-top text-[13px] leading-4"
	data-testid="artifact-activity"
>
	<svelte:element
		this={clickable ? 'button' : 'div'}
		type={clickable ? 'button' : undefined}
		class="flex max-w-full items-center gap-1.5 rounded-md px-2 py-1 text-start transition-colors {clickable
			? 'cursor-pointer hover:bg-gray-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 dark:hover:bg-gray-900'
			: ''}"
		aria-label={clickable ? `${$i18n.t('Open')}: ${documentTitle} · ${status}` : undefined}
		role={clickable ? undefined : error ? 'alert' : 'status'}
		aria-busy={!done && !error}
		on:click={() => clickable && onOpen()}
	>
		<span
			class="flex size-4 shrink-0 items-center justify-center text-gray-500 dark:text-gray-400"
			aria-hidden="true"
		>
			{#if !done && !error}<Spinner className="size-3.5" />
			{:else if kind === 'canvas'}<Document className="size-3.5" />
			{:else}<GlobeAlt className="size-3.5" />{/if}
		</span>
		<span class="flex min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
			<span
				class="min-w-0 break-words font-medium text-gray-700 dark:text-gray-200 [overflow-wrap:anywhere]"
				title={documentTitle}>{documentTitle}</span
			>
			<span
				class="text-xs {error
					? 'text-red-600 dark:text-red-400'
					: 'text-gray-500 dark:text-gray-400'}">{status}</span
			>
		</span>
	</svelte:element>
	{#if error}
		<details class="ms-7 text-xs text-gray-500 dark:text-gray-400">
			<summary class="cursor-pointer"
				>{$i18n.t('Error details', { fallbackLng: false, defaultValue: $i18n.t('Error') })}</summary
			>
			<p class="mt-1 whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{error}</p>
		</details>
	{/if}
</div>
