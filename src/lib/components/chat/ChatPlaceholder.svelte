<script lang="ts">
	import { marked } from 'marked';
	import DOMPurify from 'dompurify';

	import { config, user, models as _models, temporaryChatEnabled, type Model } from '$lib/stores';
	import { onMount, getContext } from 'svelte';
	import type { Writable } from 'svelte/store';
	import type { i18n as i18nType } from 'i18next';

	import { fade } from 'svelte/transition';

	import Suggestions from './Suggestions.svelte';
	import { sanitizeResponseContent } from '$lib/utils';
	import Tooltip from '$lib/components/common/Tooltip.svelte';
	import EyeSlash from '$lib/components/icons/EyeSlash.svelte';
	import { getChatGreeting } from '$lib/utils/chatGreeting';

	const i18n: Writable<i18nType> = getContext('i18n');

	export let modelIds: string[] = [];
	export let models: (Model | undefined)[] = [];
	export let atSelectedModel: Model | undefined;

	export let onSelect = (e) => {};

	let mounted = false;
	let selectedModelIdx = 0;
	let greetingDate = new Date();

	$: if (modelIds.length > 0) {
		selectedModelIdx = models.length - 1;
	}

	$: models = modelIds.map((id) => $_models.find((m) => m.id === id));
	$: greeting = getChatGreeting({
		name: $user?.name,
		date: greetingDate,
		seed: `${modelIds.join('|')}-${$i18n.language}`
	});

	onMount(() => {
		mounted = true;
	});
</script>

{#key mounted}
	<div class="m-auto w-full max-w-6xl px-8 lg:px-20">
		<div class="mb-0.5 flex h-8 w-full items-center justify-start">
			{#if $temporaryChatEnabled}
				<Tooltip
					content={$i18n.t(
						"This chat won't appear in history and your messages will not be saved."
					)}
					className="flex justify-start"
					placement="top"
				>
					<div class="flex w-fit items-center gap-2 text-lg text-gray-500">
						<EyeSlash strokeWidth="2.5" className="size-5" />{$i18n.t('Temporary Chat')}
					</div>
				</Tooltip>
			{/if}
		</div>

		<div
			class="mb-4 mt-2 flex items-center gap-4 text-left font-primary text-3xl text-gray-800 dark:text-gray-100"
		>
			<div>
				<div class="line-clamp-1" in:fade={{ duration: 200 }}>
					{$i18n.t(greeting.key, greeting.params)}
				</div>

				<div in:fade={{ duration: 200, delay: 200 }}>
					{#if models[selectedModelIdx]?.info?.meta?.description ?? null}
						{#if models[selectedModelIdx]?.name}
							<div class="mt-0.5 text-sm font-normal text-gray-400 dark:text-gray-500 line-clamp-1">
								{$i18n.t('Using {{model}}', { model: models[selectedModelIdx]?.name })}
							</div>
						{/if}
						<div
							class="mt-0.5 text-base font-normal text-gray-500 dark:text-gray-400 line-clamp-3 markdown"
						>
							{@html DOMPurify.sanitize(
								marked.parse(
									sanitizeResponseContent(
										models[selectedModelIdx]?.info?.meta?.description
									).replaceAll('\n', '<br>')
								)
							)}
						</div>
						{#if models[selectedModelIdx]?.info?.meta?.user}
							<div class="mt-0.5 text-sm font-normal text-gray-400 dark:text-gray-500">
								By
								{#if models[selectedModelIdx]?.info?.meta?.user.community}
									<a
										href="https://openwebui.com/m/{models[selectedModelIdx]?.info?.meta?.user
											.username}"
										>{models[selectedModelIdx]?.info?.meta?.user.name
											? models[selectedModelIdx]?.info?.meta?.user.name
											: `@${models[selectedModelIdx]?.info?.meta?.user.username}`}</a
									>
								{:else}
									{models[selectedModelIdx]?.info?.meta?.user.name}
								{/if}
							</div>
						{/if}
					{:else if models[selectedModelIdx]?.name}
						<div class=" text-gray-400 dark:text-gray-500 line-clamp-1 font-p">
							{$i18n.t('Using {{model}}', { model: models[selectedModelIdx]?.name })}
						</div>
					{/if}
				</div>
			</div>
		</div>

		<div class=" w-full font-primary" in:fade={{ duration: 200, delay: 300 }}>
			<Suggestions
				className="grid grid-cols-2"
				suggestionPrompts={atSelectedModel?.info?.meta?.suggestion_prompts ??
					models[selectedModelIdx]?.info?.meta?.suggestion_prompts ??
					$config?.default_prompt_suggestions ??
					[]}
				{onSelect}
			/>
		</div>
	</div>
{/key}
