<script lang="ts">
	import CheckCircle from '$lib/components/icons/CheckCircle.svelte';
	import XMark from '$lib/components/icons/XMark.svelte';
	import Spinner from '$lib/components/common/Spinner.svelte';
	import type { WebPreviewArtifact } from '../Artifacts/webPreview';

	export let name = '';
	export let done = false;
	export let artifact: WebPreviewArtifact | undefined = undefined;
	export let error = '';

	const labels: Record<string, [string, string]> = {
		web_preview_create: ['Creating web preview', 'Web preview created'],
		web_preview_update: ['Updating web preview', 'Web preview updated'],
		web_preview_select: ['Opening web preview', 'Web preview opened'],
		web_preview_list: ['Checking web previews', 'Web previews checked']
	};
	$: label = labels[name] ?? labels.web_preview_update;
</script>

<div
	class="w-fit py-1 text-[0.9375rem] text-gray-500 dark:text-gray-400"
	role={error ? 'alert' : 'status'}
	aria-live="polite"
>
	<span class="flex max-w-full items-center gap-1.5 font-normal {error || done ? '' : 'shimmer'}">
		{#if error}
			<span class="text-red-600 dark:text-red-400"><XMark className="size-4" /></span>
		{:else if done}
			<span class="text-gray-500 dark:text-gray-400"><CheckCircle className="size-4" /></span>
		{:else}
			<Spinner className="size-4" />
		{/if}
		<span class="max-w-80 truncate text-black dark:text-white">
			{error || (done ? label[1] : label[0])}{artifact?.title ? `: ${artifact.title}` : ''}
		</span>
	</span>
</div>
