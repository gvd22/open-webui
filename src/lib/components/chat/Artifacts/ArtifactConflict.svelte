<script lang="ts">
	import { getContext } from 'svelte';
	import ArtifactComparison from './ArtifactComparison.svelte';
	const i18n = getContext<any>('i18n');
	export let before = '';
	export let after = '';
	export let busy = false;
	export let onRecover: () => void;
	export let onDiscard: () => void;
	let compare = false;
</script>

<section
	class="shrink-0 border-y border-amber-200 bg-amber-50 p-3 text-xs text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100"
	aria-label={$i18n.t('Unsaved draft')}
>
	<p role="status">
		{$i18n.t('This document changed elsewhere. Your draft is kept; saving is paused.')}
	</p>
	<div class="mt-2 flex flex-wrap gap-3">
		<button
			type="button"
			class="font-medium underline"
			aria-expanded={compare}
			on:click={() => (compare = !compare)}>{$i18n.t('Compare')}</button
		>
		<button
			type="button"
			class="font-medium underline disabled:opacity-50"
			disabled={busy}
			on:click={onRecover}>{$i18n.t('Recover draft')}</button
		>
		<button type="button" class="underline disabled:opacity-50" disabled={busy} on:click={onDiscard}
			>{$i18n.t('Discard draft')}</button
		>
	</div>
	{#if compare}<ArtifactComparison
			{before}
			{after}
			beforeLabel="Server version"
			afterLabel="Your draft"
		/>{/if}
</section>
