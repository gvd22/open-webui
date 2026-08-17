<script lang="ts">
	import DocumentZoomControls from './DocumentZoomControls.svelte';

	export let percent = 100;
	export let minimum = 50;
	export let maximum = 300;
	export let pending = false;
	export let zoomOutLabel = 'Zoom out';
	export let resetLabel = 'Reset zoom';
	export let zoomInLabel = 'Zoom in';
	export let onZoomOut: () => void = () => {};
	export let onReset: () => void = () => {};
	export let onZoomIn: () => void = () => {};
</script>

<div
	class="flex items-center gap-0.5 rounded-xl border border-gray-200/80 bg-white/95 p-1 shadow-lg backdrop-blur-md dark:border-gray-700/80 dark:bg-gray-850/95"
>
	<DocumentZoomControls
		{percent}
		{minimum}
		{maximum}
		{pending}
		{zoomOutLabel}
		{resetLabel}
		{zoomInLabel}
		{onZoomOut}
		{onReset}
		{onZoomIn}
	/>
</div>
