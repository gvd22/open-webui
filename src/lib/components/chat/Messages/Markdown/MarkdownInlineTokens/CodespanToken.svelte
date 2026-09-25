<script lang="ts">
	import { copyToClipboard, unescapeHtml } from '$lib/utils';
	import { toast } from 'svelte-sonner';

	import { getContext } from 'svelte';
	import type { Writable } from 'svelte/store';
	import type { i18n as i18nType } from 'i18next';

	import { settings, workspaceOutputFiles } from '$lib/stores';
	import {
		isKnownWorkspaceOutputPath,
		isWorkspaceOutputPath,
		WORKSPACE_OPEN_OUTPUT_EVENT
	} from '$lib/components/chat/Artifacts/workspaceOutputs';

	const i18n = getContext<Writable<i18nType>>('i18n');

	export let token;
	export let done = true;

	$: text = unescapeHtml(token.text);
	$: isWorkspaceOutput =
		isKnownWorkspaceOutputPath($workspaceOutputFiles, text) || isWorkspaceOutputPath(text);

	const copy = () => {
		copyToClipboard(text);
		toast.success($i18n.t('Copied to clipboard'));
	};

	const openWorkspaceOutput = () => {
		window.dispatchEvent(
			new CustomEvent(WORKSPACE_OPEN_OUTPUT_EVENT, {
				detail: { path: text }
			})
		);
	};
</script>

{#if isWorkspaceOutput}
	<button
		type="button"
		class="codespan cursor-pointer border-0 hover:bg-gray-200 dark:hover:bg-gray-700 {!done &&
		(($settings as any)?.chatFadeStreamingText ?? true)
			? 'fade-in-token'
			: ''}"
		aria-label={$i18n.t('Open {{name}}', { name: text.split('/').at(-1) || text })}
		title={$i18n.t('Open file')}
		on:click={openWorkspaceOutput}>{text}</button
	>
{:else}
	<!-- svelte-ignore a11y-click-events-have-key-events -->
	<!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
	<code
		class="codespan cursor-pointer {!done && (($settings as any)?.chatFadeStreamingText ?? true)
			? 'fade-in-token'
			: ''}"
		on:click={copy}>{text}</code
	>
{/if}
