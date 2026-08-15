<script lang="ts">
	import { getContext } from 'svelte';

	import Folder from '$lib/components/icons/Folder.svelte';
	import GlobeAlt from '$lib/components/icons/GlobeAlt.svelte';
	import Terminal from '$lib/components/icons/Terminal.svelte';
	import { isKeyboardActivationClick } from './workspace';

	const i18n = getContext('i18n');

	export let terminalId: string | null = null;
	export let filesAvailable = false;
	export let onOpenFiles: () => void = () => {};
	export let onOpenBrowser: () => void = () => {};
	export let onOpenTerminal: () => void = () => {};
	$: hasTools = Boolean(terminalId || filesAvailable);
	const onKeyboardClick = (event: MouseEvent, action: () => void) => {
		if (isKeyboardActivationClick(event.detail)) action();
	};

	const openFiles = () => onOpenFiles();
	const openBrowser = () => onOpenBrowser();
	const openTerminal = () => terminalId && onOpenTerminal();
</script>

<div class="flex h-full items-center justify-center px-6 py-10">
	<div
		class="w-full max-w-sm rounded-xl border border-gray-100 bg-gray-50/60 p-1.5 shadow-sm dark:border-gray-800 dark:bg-gray-900/40"
		aria-label={$i18n.t('Workspace tools')}
	>
		{#if terminalId}
			<button
				type="button"
				class="flex h-11 w-full items-center gap-3 rounded-lg px-3 text-left text-gray-700 transition hover:bg-white hover:shadow-sm dark:text-gray-200 dark:hover:bg-gray-800 dark:hover:shadow-none"
				on:mousedown|preventDefault={openTerminal}
				on:click={(event) => onKeyboardClick(event, openTerminal)}
			>
				<span
					class="flex size-7 shrink-0 items-center justify-center rounded-md bg-white text-gray-500 shadow-sm dark:bg-gray-800 dark:text-gray-300 dark:shadow-none"
				>
					<Terminal className="size-4" strokeWidth="1.6" />
				</span>
				<span class="text-sm font-medium">{$i18n.t('Terminal')}</span>
			</button>

			<button
				type="button"
				class="flex h-11 w-full items-center gap-3 rounded-lg px-3 text-left text-gray-700 transition hover:bg-white hover:shadow-sm dark:text-gray-200 dark:hover:bg-gray-800 dark:hover:shadow-none"
				on:mousedown|preventDefault={openBrowser}
				on:click={(event) => onKeyboardClick(event, openBrowser)}
			>
				<span
					class="flex size-7 shrink-0 items-center justify-center rounded-md bg-white text-gray-500 shadow-sm dark:bg-gray-800 dark:text-gray-300 dark:shadow-none"
				>
					<GlobeAlt className="size-4" strokeWidth="1.6" />
				</span>
				<span class="text-sm font-medium">{$i18n.t('Browser')}</span>
			</button>
		{/if}

		{#if filesAvailable}
			<button
				type="button"
				class="flex h-11 w-full items-center gap-3 rounded-lg px-3 text-left text-gray-700 transition hover:bg-white hover:shadow-sm dark:text-gray-200 dark:hover:bg-gray-800 dark:hover:shadow-none"
				on:mousedown|preventDefault={openFiles}
				on:click={(event) => onKeyboardClick(event, openFiles)}
			>
				<span
					class="flex size-7 shrink-0 items-center justify-center rounded-md bg-white text-gray-500 shadow-sm dark:bg-gray-800 dark:text-gray-300 dark:shadow-none"
				>
					<Folder className="size-4" />
				</span>
				<span class="text-sm font-medium">{$i18n.t('Files')}</span>
			</button>
		{/if}

		{#if !hasTools}
			<div class="flex h-20 items-center justify-center px-4 text-sm text-gray-400">
				{$i18n.t('No workspace tools available')}
			</div>
		{/if}
	</div>
</div>
