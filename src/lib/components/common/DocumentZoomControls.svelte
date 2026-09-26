<script lang="ts">
	export let percent = 100;
	export let minimum = 50;
	export let maximum = 400;
	export let pending = false;
	export let zoomOutLabel = 'Zoom out';
	export let resetLabel = 'Reset zoom';
	export let zoomInLabel = 'Zoom in';
	export let onZoomOut: () => void = () => {};
	export let onReset: () => void = () => {};
	export let onZoomIn: () => void = () => {};
</script>

<button
	type="button"
	class="flex size-8 items-center justify-center rounded-lg text-gray-500 transition hover:bg-gray-100 hover:text-gray-900 disabled:pointer-events-none disabled:opacity-30 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white"
	disabled={percent <= minimum || pending}
	on:click={onZoomOut}
	aria-label={zoomOutLabel}>−</button
>
<button
	type="button"
	class="min-w-[3.25rem] rounded-lg px-1.5 py-1.5 text-center text-xs font-medium tabular-nums text-gray-700 transition hover:bg-gray-100 disabled:pointer-events-none disabled:opacity-50 dark:text-gray-200 dark:hover:bg-gray-800"
	disabled={pending}
	on:click={onReset}
	aria-label={resetLabel}>{percent}%</button
>
<button
	type="button"
	class="flex size-8 items-center justify-center rounded-lg text-gray-500 transition hover:bg-gray-100 hover:text-gray-900 disabled:pointer-events-none disabled:opacity-30 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white"
	disabled={percent >= maximum || pending}
	on:click={onZoomIn}
	aria-label={zoomInLabel}>+</button
>
