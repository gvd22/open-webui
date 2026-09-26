<script lang="ts">
	import { fileText } from '$lib/components/chat/Artifacts/fileText';
	import { getContext, onDestroy, tick } from 'svelte';
	import type { Writable } from 'svelte/store';
	import type { i18n as i18nType } from 'i18next';

	import Icon from '$lib/components/chat/FileNav/Icon.svelte';
	import { fileIconName, fileIconTone } from '$lib/components/chat/FileNav/fileIcon';
	import Folder from '$lib/components/icons/Folder.svelte';
	import XMark from '$lib/components/icons/XMark.svelte';

	import type { WorkspaceTab } from './workspace';
	import { WORKSPACE_FILES_ID } from './workspace';

	const i18n: Writable<i18nType> = getContext('i18n');

	export let tabs: WorkspaceTab[] = [];
	export let selectedIndex = 0;
	export let onSelect: (tab: WorkspaceTab) => void | Promise<void> = () => {};
	export let onClose: () => void = () => {};
	export let onCloseTab: (tab: WorkspaceTab) => void | Promise<void> = () => {};
	export let onReorder: (sourceId: string, targetId: string) => void = () => {};
	let draggedTabId = '';
	let dragTargetId = '';
	let pressedTabId = '';
	let pointerStart = { x: 0, y: 0 };
	let tabListElement: HTMLElement;
	let tabStripElement: HTMLElement;
	$: filesTab = tabs.find((tab) => tab.id === WORKSPACE_FILES_ID);
	$: documentTabs = tabs.filter((tab) => tab.id !== WORKSPACE_FILES_ID);
	$: navigationTabs = filesTab ? [filesTab, ...documentTabs] : documentTabs;
	let closeButtonElement: HTMLButtonElement;
	const getTabElements = () =>
		Array.from(tabListElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? []);
	$: activeTabId = tabs.find((tab) => tab.index === selectedIndex)?.id;
	const revealActiveTab = async (id: string) => {
		await tick();
		if (activeTabId !== id || !tabStripElement) return;
		const element = tabStripElement;
		const selected = element.querySelector<HTMLElement>('[aria-selected="true"]');
		if (!selected) return;
		const item = selected.parentElement!.getBoundingClientRect();
		const list = element.getBoundingClientRect();
		// Scroll only the tab strip, never the chat or document viewport.
		if (item.left < list.left) element.scrollLeft += item.left - list.left;
		else if (item.right > list.right) element.scrollLeft += item.right - list.right;
	};
	$: if (activeTabId && tabListElement) void revealActiveTab(activeTabId);

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

	const onTabKeydown = async (event: KeyboardEvent, tab: WorkspaceTab) => {
		const currentIndex = navigationTabs.findIndex((item) => item.id === tab.id);
		let nextIndex = currentIndex;
		if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % tabs.length;
		else if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
		else if (event.key === 'Home') nextIndex = 0;
		else if (event.key === 'End') nextIndex = tabs.length - 1;
		else return;

		event.preventDefault();
		const nextTab = navigationTabs[nextIndex];
		if (!nextTab) return;
		await selectTab(nextTab);
		await tick();
		Array.from(tabListElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? [])[
			nextIndex
		]?.focus();
	};

	const closeTabAndFocus = async (tab: WorkspaceTab) => {
		const closedIndex = navigationTabs.findIndex((item) => item.id === tab.id);
		await onCloseTab(tab);
		await tick();
		const remainingTabs = getTabElements();
		if (remainingTabs.length) {
			remainingTabs[Math.min(Math.max(closedIndex, 0), remainingTabs.length - 1)]?.focus();
		} else {
			closeButtonElement?.focus();
		}
	};

	const finishTabDrag = () => {
		draggedTabId = '';
		dragTargetId = '';
		pressedTabId = '';
	};
	let cancelTabDrag = () => {};
	onDestroy(() => cancelTabDrag());

	const beginTabMouse = (event: MouseEvent, tab: WorkspaceTab) => {
		if (event.button !== 0) return;
		cancelTabDrag();
		pressedTabId = tab.id;
		pointerStart = { x: event.clientX, y: event.clientY };
		const move = (moveEvent: MouseEvent) => {
			if (!pressedTabId) return;
			const distance = Math.hypot(
				moveEvent.clientX - pointerStart.x,
				moveEvent.clientY - pointerStart.y
			);
			if (distance < 5) return;
			draggedTabId = tab.id;
			const target = document
				.elementFromPoint(moveEvent.clientX, moveEvent.clientY)
				?.closest<HTMLElement>('[data-workspace-id]');
			dragTargetId = target?.dataset.workspaceId ?? '';
			moveEvent.preventDefault();
		};

		const end = () => {
			if (draggedTabId && dragTargetId && draggedTabId !== dragTargetId) {
				onReorder(draggedTabId, dragTargetId);
			}
			cancelTabDrag();
		};
		cancelTabDrag = () => {
			window.removeEventListener('mousemove', move);
			window.removeEventListener('mouseup', end);
			window.removeEventListener('blur', cancelTabDrag);
			finishTabDrag();
		};

		window.addEventListener('mousemove', move, { passive: false });
		window.addEventListener('mouseup', end, { once: true });
		window.addEventListener('blur', cancelTabDrag, { once: true });
	};
</script>

<div
	class="workspace-tabs shrink-0 border-b border-gray-100 bg-white pr-2 py-1.5 dark:border-gray-800 dark:bg-gray-850"
	data-testid="workspace-tabs"
>
	<div class="flex min-h-8 items-center gap-1">
		<div
			bind:this={tabListElement}
			class="flex min-w-0 flex-1 items-center gap-2"
			role="tablist"
			aria-label={fileText($i18n, 'Open documents')}
		>
			{#if filesTab}
				<button
					type="button"
					role="tab"
					id={`workspace-tab-${filesTab.index}`}
					aria-label={$i18n.t('Files')}
					title={$i18n.t('Files')}
					aria-selected={filesTab.index === selectedIndex}
					aria-controls={`workspace-panel-${filesTab.index}`}
					tabindex={filesTab.index === selectedIndex ? 0 : -1}
					class="flex h-8 w-10 shrink-0 items-center justify-center rounded-r-lg transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-gray-400 {filesTab.index ===
					selectedIndex
						? 'bg-gray-100 text-gray-900 dark:bg-gray-800 dark:text-white'
						: 'text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800'}"
					on:click|stopPropagation={() => void selectTab(filesTab)}
					on:keydown={(event) => void onTabKeydown(event, filesTab)}
				>
					<Folder className="size-4" />
				</button>
			{/if}
			<div
				bind:this={tabStripElement}
				class="scrollbar-none flex min-w-0 flex-1 items-center gap-1 overflow-x-auto"
			>
				{#each documentTabs as tab (tab.id)}
					<div
						class="group relative h-8 min-w-[7rem] max-w-[14rem] shrink-0 rounded-lg text-xs transition {tab.index ===
						selectedIndex
							? 'bg-gray-100 font-medium text-gray-900 dark:bg-gray-800 dark:text-white'
							: 'text-gray-500 hover:bg-gray-50 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-gray-800/60 dark:hover:text-gray-100'} {draggedTabId ===
						tab.id
							? 'opacity-40'
							: ''} {dragTargetId === tab.id && draggedTabId !== tab.id
							? 'ring-1 ring-gray-400 dark:ring-gray-500'
							: ''}"
					>
						<button
							type="button"
							draggable="false"
							role="tab"
							id={`workspace-tab-${tab.index}`}
							aria-selected={tab.index === selectedIndex}
							aria-controls={`workspace-panel-${tab.index}`}
							tabindex={tab.index === selectedIndex ? 0 : -1}
							title={tab.title}
							data-workspace-id={tab.id}
							data-workspace-tab-index={tab.index}
							class="flex h-8 w-full min-w-0 items-center gap-2 px-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-400 dark:focus-visible:ring-gray-500 {tab.closable
								? 'pr-8'
								: 'pr-3'}"
							on:mousedown|stopPropagation={(event) => beginTabMouse(event, tab)}
							on:click|stopPropagation={() => void selectTab(tab)}
							on:keydown={(event) => void onTabKeydown(event, tab)}
						>
							<span
								class="shrink-0 {fileIconTone(tab.title)}"
								data-workspace-icon={fileIconName(tab.title)}
							>
								<Icon name={fileIconName(tab.title)} size={16} strokeWidth={1.5} />
							</span>
							<span class="truncate">{tab.title}</span>
						</button>

						{#if tab.closable}
							<button
								type="button"
								draggable="false"
								class="absolute right-1 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded-md text-gray-400 opacity-70 transition hover:bg-gray-200 hover:text-gray-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-400 dark:text-gray-500 dark:hover:bg-gray-700 dark:hover:text-gray-100"
								aria-label={`${$i18n.t('Close')}: ${tab.title}`}
								title={`${$i18n.t('Close')}: ${tab.title}`}
								on:mousedown|preventDefault|stopPropagation={() => {}}
								on:click|preventDefault|stopPropagation={() => void closeTabAndFocus(tab)}
							>
								<XMark className="size-3.5" />
							</button>
						{/if}
					</div>
				{/each}
			</div>
		</div>

		<button
			bind:this={closeButtonElement}
			type="button"
			class="flex size-8 shrink-0 items-center justify-center rounded-md text-gray-500 transition hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white"
			aria-label={$i18n.t('Close')}
			title={$i18n.t('Close')}
			on:mousedown|preventDefault|stopPropagation={() => {}}
			on:click|preventDefault|stopPropagation={onClose}
		>
			<XMark className="size-4" />
		</button>
	</div>
</div>
