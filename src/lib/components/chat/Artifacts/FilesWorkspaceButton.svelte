<script lang="ts">
	import { getContext } from 'svelte';
	import { showArtifacts, showControls, showCallOverlay, showEmbeds } from '$lib/stores';
	import { showFilesWorkspace } from '$lib/stores/fileWorkspace';
	import Folder from '$lib/components/icons/Folder.svelte';
	import Tooltip from '$lib/components/common/Tooltip.svelte';
	const i18n: import('svelte/store').Writable<import('i18next').i18n> = getContext('i18n');
	export let available = false;
	function toggle() {
		const open = !($showControls && $showFilesWorkspace);
		showArtifacts.set(false);
		showCallOverlay.set(false);
		showEmbeds.set(false);
		showFilesWorkspace.set(open);
		showControls.set(open);
	}
</script>

{#if available}
	<Tooltip content={$i18n.t('Files')}>
		<button
			type="button"
			aria-label={$i18n.t('Files')}
			aria-pressed={$showControls && $showFilesWorkspace}
			class="flex size-6 items-center justify-center rounded-lg text-gray-500 transition hover:bg-gray-50/40 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-800/40 dark:hover:text-gray-200"
			on:click={toggle}
		>
			<Folder className="size-4" />
		</button>
	</Tooltip>
{/if}
