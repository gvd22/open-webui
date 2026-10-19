<script lang="ts">
	// AI-2390: suggestions as cards (max. three) so they stay readable on the welcome
	// background. Fixed height, so nothing shifts while they load.
	import { getContext } from 'svelte';
	import type { Writable } from 'svelte/store';
	import type { i18n as i18nType } from 'i18next';
	import Bolt from '$lib/components/icons/Bolt.svelte';

	const i18n = getContext<Writable<i18nType>>('i18n');

	export let prompts: { id?: string; title?: string[]; translatedContent: string }[] = [];
	export let onSelect: (e: { type: 'prompt'; data: string }) => void = () => {};
	// staggered fade-in (off when the welcome screen just remounted)
	export let animate = true;
</script>

<div class="mb-1.5 flex text-xs text-gray-600 dark:text-gray-400">
	<!-- pill, so the label stays clean on top of the background pattern -->
	<span
		data-welcome-avoid
		class="flex items-center gap-1 px-2 py-0.5 rounded-full bg-white/85 dark:bg-gray-850/85"
	>
		<Bolt />
		<span class="uppercase tracking-wide font-medium">{$i18n.t('Suggested')}</span>
	</span>
</div>

<ul class="h-[12.5rem] w-full flex flex-col gap-2 p-1">
	{#each prompts.slice(0, 3) as prompt, idx (prompt.id || `${prompt.translatedContent}-${idx}`)}
		{@const title = prompt.title?.[0] ? prompt.title : null}
		<li data-welcome-avoid class:waterfall={animate} style="animation-delay: {idx * 45}ms">
			<button
				class="flex flex-col w-full text-left leading-snug px-4 py-2.5 rounded-xl transition
				       bg-white dark:bg-gray-850 border border-gray-100 dark:border-gray-800 shadow-sm
				       hover:border-gray-200 dark:hover:border-gray-700
				       focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
				on:click={() => onSelect({ type: 'prompt', data: prompt.translatedContent })}
			>
				<span class="text-sm font-medium text-gray-900 dark:text-gray-100 line-clamp-1">
					{title ? title[0] : prompt.translatedContent}
				</span>
				<span class="text-xs text-gray-600 dark:text-gray-400 line-clamp-1">
					{title ? title[1] : $i18n.t('Prompt')}
				</span>
			</button>
		</li>
	{/each}
</ul>

<style>
	.waterfall {
		opacity: 0;
		animation: card-in 200ms ease forwards;
	}

	@keyframes card-in {
		from {
			opacity: 0;
			transform: translateY(6px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.waterfall {
			opacity: 1;
			animation: none;
		}
	}
</style>
