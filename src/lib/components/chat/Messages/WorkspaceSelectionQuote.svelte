<script lang="ts">
	import { getContext } from 'svelte';
	import XMark from '$lib/components/icons/XMark.svelte';
	const i18n = getContext<any>('i18n');
	export let text = '';
	export let title = 'Canvas';
	export let onRemove: (() => void) | undefined = undefined;
</script>

<div
	class="flex min-w-0 items-start gap-2 border-l-2 border-gray-300 py-1 pl-3 text-xs dark:border-gray-600"
	aria-label={$i18n.t('Selected passage')}
>
	<div class="min-w-0 flex-1">
		<div class="truncate font-medium text-gray-600 dark:text-gray-300">{title.slice(0, 100)}</div>
		<blockquote
			class="m-0 mt-1 line-clamp-3 whitespace-pre-wrap break-words text-gray-500 dark:text-gray-400"
		>
			{text.slice(0, 8000)}
		</blockquote>
	</div>
	{#if onRemove}<button
			type="button"
			class="shrink-0 rounded p-1 hover:bg-gray-100 dark:hover:bg-gray-800"
			aria-label={$i18n.t('Remove selection')}
			on:click={onRemove}><XMark className="size-3.5" /></button
		>{/if}
</div>
