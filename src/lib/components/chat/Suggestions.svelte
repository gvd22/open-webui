<script lang="ts">
	import Fuse from 'fuse.js';
	import Bolt from '$lib/components/icons/Bolt.svelte';
	import SuggestionCards from './Placeholder/SuggestionCards.svelte';
	import { stableRandomRank } from '$lib/utils/welcome';
	import { getContext } from 'svelte';
	import { settings, WEBUI_NAME } from '$lib/stores';
	import { WEBUI_VERSION } from '$lib/constants';

	const i18n = getContext('i18n');

	export let suggestionPrompts = [];
	export let className = '';
	export let inputValue = '';
	export let onSelect = () => {};
	// AI-2390: welcome screen with background shows cards instead of the plain list
	export let cards = false;
	export let animate = true;

	let sortedPrompts = [];

	const fuseOptions = {
		keys: ['content', 'title'],
		threshold: 0.5
	};

	let fuse;
	let filteredPrompts = [];

	// Initialize Fuse
	$: fuse = new Fuse(sortedPrompts, fuseOptions);

	// Update the filteredPrompts if inputValue changes
	// Only increase version if something wirklich geändert hat
	$: if (fuse) getFilteredPrompts(inputValue);

	// Compare objects so translated text refreshes even when IDs stay the same.
	function arraysEqual(a, b) {
		if (a.length !== b.length) return false;
		for (let i = 0; i < a.length; i++) {
			if (a[i] !== b[i]) {
				return false;
			}
		}
		return true;
	}

	const getFilteredPrompts = (inputValue) => {
		if (inputValue.length > 500) {
			filteredPrompts = [];
		} else {
			const newFilteredPrompts =
				inputValue.trim() && fuse
					? fuse.search(inputValue.trim()).map((result) => result.item)
					: sortedPrompts;

			// Compare with the oldFilteredPrompts
			// If there's a difference, update array + version
			if (!arraysEqual(filteredPrompts, newFilteredPrompts)) {
				filteredPrompts = newFilteredPrompts;
			}
		}
	};

	$: if (suggestionPrompts) {
		// stable per page load, so a remount does not reshuffle
		sortedPrompts = [...(suggestionPrompts ?? [])].sort(
			(a, b) => stableRandomRank(a) - stableRandomRank(b)
		);
	}
</script>

<!-- AI-2390: in card mode the area keeps the card height even when typing filters out
	every suggestion, so the centred input does not jump -->
<div class={cards ? 'min-h-[14.125rem]' : ''}>
{#if cards && filteredPrompts.length > 0}
	<SuggestionCards prompts={filteredPrompts} {onSelect} {animate} />
{:else}
<div class="mb-1 flex gap-1 text-xs font-normal items-center text-gray-600 dark:text-gray-400">
	{#if filteredPrompts.length > 0}
		<Bolt />
		{$i18n.t('Suggested')}
	{:else}
		<!-- Keine Vorschläge -->

		<div
			class="flex w-full {$settings?.landingPageMode === 'chat'
				? ' -mt-1'
				: 'text-center items-center justify-center'}  self-start text-gray-600 dark:text-gray-400"
		>
			<!-- LICENSE covers this Open WebUI footer identifier.
			Do not alter, remove, obscure, or replace it except as LICENSE permits:
			https://docs.openwebui.com/license. -->
			{$WEBUI_NAME} ‧ v{WEBUI_VERSION}
		</div>
	{/if}
</div>

<div class="h-36 w-full">
	{#if filteredPrompts.length > 0}
		<div role="list" class="max-h-36 overflow-auto scrollbar-none items-start {className}">
			{#each filteredPrompts as prompt, idx (prompt.id || `${prompt.content}-${idx}`)}
				<!-- svelte-ignore a11y-no-interactive-element-to-noninteractive-role -->
				<button
					role="listitem"
					class="waterfall flex flex-col flex-1 shrink-0 w-full justify-between
				       px-2.5 py-1.5 rounded-lg bg-transparent transition-colors
				       hover:text-gray-950 dark:hover:text-white group"
					style="animation-delay: {idx * 45}ms"
					on:click={() => onSelect({ type: 'prompt', data: prompt.content })}
				>
					<div class="flex flex-col text-left leading-snug">
						{#if prompt.title && prompt.title[0] !== ''}
							<div
								class="text-sm font-normal group-hover:text-gray-950 dark:text-gray-300 dark:group-hover:text-white transition line-clamp-1"
							>
								{prompt.title[0]}
							</div>
							<div
								class="text-xs text-gray-600 group-hover:text-gray-900 dark:text-gray-400 dark:group-hover:text-gray-100 font-normal line-clamp-1"
							>
								{prompt.title[1]}
							</div>
						{:else}
							<div
								class="text-sm font-normal group-hover:text-gray-950 dark:text-gray-300 dark:group-hover:text-white transition line-clamp-1"
							>
								{prompt.content}
							</div>
							<div
								class="text-xs text-gray-600 group-hover:text-gray-900 dark:text-gray-400 dark:group-hover:text-gray-100 font-normal line-clamp-1"
							>
								{$i18n.t('Prompt')}
							</div>
						{/if}
					</div>
				</button>
			{/each}
		</div>
	{/if}
</div>
{/if}
</div>

<style>
	/* Waterfall animation for the suggestions */
	@keyframes fadeInUp {
		0% {
			opacity: 0;
			transform: translateY(6px);
		}
		100% {
			opacity: 1;
			transform: translateY(0);
		}
	}

	.waterfall {
		opacity: 0;
		animation-name: fadeInUp;
		animation-duration: 200ms;
		animation-fill-mode: forwards;
		animation-timing-function: ease;
	}
</style>
