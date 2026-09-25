<script lang="ts">
	import { getContext } from 'svelte';
	import { changedText } from './artifactEditing';
	const i18n = getContext<any>('i18n');
	export let before = '';
	export let after = '';
	export let beforeLabel = 'Before';
	export let afterLabel = 'After';
	$: changes = changedText(before, after);
</script>

<div
	class="grid max-h-64 grid-cols-1 gap-2 overflow-auto p-3 text-xs sm:grid-cols-2"
	aria-label={$i18n.t('Changes')}
>
	<div class="min-w-0">
		<div class="mb-1 font-medium">{$i18n.t(beforeLabel)}</div>
		<pre
			class="whitespace-pre-wrap break-words bg-red-50 p-2 text-red-900 dark:bg-red-950/30 dark:text-red-200">{changes.before ||
				$i18n.t('No text')}</pre>
	</div>
	<div class="min-w-0">
		<div class="mb-1 font-medium">{$i18n.t(afterLabel)}</div>
		<pre
			class="whitespace-pre-wrap break-words bg-green-50 p-2 text-green-900 dark:bg-green-950/30 dark:text-green-200">{changes.after ||
				$i18n.t('No text')}</pre>
	</div>
	{#if changes.truncated}<p class="text-gray-500 sm:col-span-2">
			{$i18n.t('Comparison shortened')}
		</p>{/if}
</div>
