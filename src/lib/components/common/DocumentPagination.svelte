<script lang="ts">
	import ChevronLeft from '$lib/components/icons/ChevronLeft.svelte';
	import ChevronRight from '$lib/components/icons/ChevronRight.svelte';

	export let current = 1;
	export let total = 1;
	export let pending = false;
	export let previousLabel = 'Previous page';
	export let nextLabel = 'Next page';
	export let onPrevious: () => void = () => {};
	export let onNext: () => void = () => {};
</script>

<div
	class="document-pagination flex items-center gap-0.5 rounded-xl border border-gray-200/80 bg-white/95 p-1 text-gray-600 shadow-lg backdrop-blur-md dark:border-gray-700/80 dark:bg-gray-850/95 dark:text-gray-300"
>
	<button
		type="button"
		class="flex size-8 items-center justify-center rounded-lg transition hover:bg-gray-100 hover:text-gray-900 disabled:pointer-events-none disabled:opacity-30 dark:hover:bg-gray-800 dark:hover:text-white"
		disabled={current <= 1 || pending}
		aria-label={previousLabel}
		on:click={onPrevious}
	>
		<ChevronLeft className="size-4" />
	</button>

	<div
		aria-live="polite"
		class="min-w-[4.5rem] select-none px-1 text-center text-xs font-medium tabular-nums text-gray-700 dark:text-gray-200"
	>
		{current} / {total}
	</div>

	<button
		type="button"
		class="flex size-8 items-center justify-center rounded-lg transition hover:bg-gray-100 hover:text-gray-900 disabled:pointer-events-none disabled:opacity-30 dark:hover:bg-gray-800 dark:hover:text-white"
		disabled={current >= total || pending}
		aria-label={nextLabel}
		on:click={onNext}
	>
		<ChevronRight className="size-4" />
	</button>

	{#if $$slots.default}
		<div
			class="ml-0.5 flex items-center gap-0.5 border-l border-gray-200/80 pl-1 dark:border-gray-700/80"
		>
			<slot />
		</div>
	{/if}
</div>
