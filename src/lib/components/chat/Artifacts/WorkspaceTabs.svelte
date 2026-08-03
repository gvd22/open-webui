<script lang="ts">
	import { getContext } from 'svelte';

	import CodeBracket from '$lib/components/icons/CodeBracket.svelte';
	import Document from '$lib/components/icons/Document.svelte';
	import Folder from '$lib/components/icons/Folder.svelte';
	import GlobeAlt from '$lib/components/icons/GlobeAlt.svelte';
	import Terminal from '$lib/components/icons/Terminal.svelte';
	import XMark from '$lib/components/icons/XMark.svelte';

	import type { WorkspaceTab } from './workspace';

	const i18n = getContext('i18n');

	export let tabs: WorkspaceTab[] = [];
	export let selectedIndex = 0;
	export let onSelect: (tab: WorkspaceTab) => void | Promise<void> = () => {};
	export let onClose: () => void = () => {};
	export let onCloseTab: (tab: WorkspaceTab) => void = () => {};

	const iconKind = (kind: string) => {
		if (kind === 'canvas-note') return 'document';
		if (kind.includes('terminal')) return 'terminal';
		if (kind.includes('file')) return 'files';
		if (kind.includes('jira') || kind.includes('confluence') || kind.includes('bitbucket')) {
			return 'connector';
		}
		return 'code';
	};

	// The active editor can be replaced before the pointer emits its final click.
	let selectingTabId = '';
	const selectTab = async (tab: WorkspaceTab) => {
		if (selectedIndex === tab.index || selectingTabId === tab.id) return;
		selectingTabId = tab.id;
		try {
			await onSelect(tab);
		} finally {
			selectingTabId = '';
		}
	};
</script>

<div
	class="workspace-tabs shrink-0 border-b border-gray-100 bg-gray-50/70 px-2 pt-1.5 dark:border-gray-800 dark:bg-gray-900/50"
	data-testid="workspace-tabs"
>
	<div class="flex min-h-9 items-end gap-1">
		<div
			class="scrollbar-hidden flex min-w-0 flex-1 items-end gap-1 overflow-x-auto"
			role="tablist"
			aria-label={$i18n.t('Open documents')}
		>
			{#each tabs as tab (tab.id)}
				<div
					class="group relative h-9 min-w-[7rem] max-w-[14rem] shrink-0 rounded-t-md text-xs transition {tab.index ===
					selectedIndex
						? 'bg-white font-medium text-gray-900 shadow-[0_-1px_0_rgba(0,0,0,0.03)] dark:bg-gray-950 dark:text-white'
						: 'text-gray-500 hover:bg-gray-100 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100'}"
				>
					<button
						type="button"
						role="tab"
						aria-selected={tab.index === selectedIndex}
						aria-controls="workspace-active-content"
						title={tab.title}
						data-workspace-id={tab.id}
						class="flex h-9 w-full min-w-0 items-center gap-2 px-3 pr-8 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-400 dark:focus-visible:ring-gray-500"
						on:mousedown|preventDefault={() => selectTab(tab)}
						on:click={() => selectTab(tab)}
					>
						<span
							class="shrink-0 text-gray-400 group-hover:text-gray-600 dark:group-hover:text-gray-300"
						>
							{#if iconKind(tab.kind) === 'document'}
								<Document className="size-4" />
							{:else if iconKind(tab.kind) === 'terminal'}
								<Terminal className="size-4" />
							{:else if iconKind(tab.kind) === 'files'}
								<Folder className="size-4" />
							{:else if iconKind(tab.kind) === 'connector'}
								<GlobeAlt className="size-4" />
							{:else}
								<CodeBracket className="size-4" />
							{/if}
						</span>
						<span class="truncate">{tab.title}</span>
					</button>

					<button
						type="button"
						class="absolute right-1 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded-md text-gray-400 opacity-0 transition hover:bg-gray-100 hover:text-gray-800 focus-visible:opacity-100 dark:text-gray-500 dark:hover:bg-gray-800 dark:hover:text-gray-100 {tab.index ===
						selectedIndex
							? 'opacity-100'
							: 'group-hover:opacity-100'}"
						aria-label={`${$i18n.t('Close')}: ${tab.title}`}
						title={`${$i18n.t('Close')}: ${tab.title}`}
						on:mousedown|preventDefault|stopPropagation
						on:click|stopPropagation={() => onCloseTab(tab)}
					>
						<XMark className="size-3.5" />
					</button>

					{#if tab.index === selectedIndex}
						<span
							class="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-gray-800 dark:bg-gray-200"
						></span>
					{/if}
				</div>
			{/each}
		</div>

		<button
			type="button"
			class="mb-0.5 flex size-8 shrink-0 items-center justify-center rounded-md text-gray-500 transition hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white"
			aria-label={$i18n.t('Close')}
			title={$i18n.t('Close')}
			on:mousedown|stopPropagation
			on:click={onClose}
		>
			<XMark className="size-4" />
		</button>
	</div>
</div>
