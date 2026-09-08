<script lang="ts">
	import { getContext, tick } from 'svelte';
	import type { Writable } from 'svelte/store';
	import type { i18n as i18nType } from 'i18next';

	import Icon from '$lib/components/chat/FileNav/Icon.svelte';
	import { fileIconName } from '$lib/components/chat/FileNav/fileIcon';
	import CodeBracket from '$lib/components/icons/CodeBracket.svelte';
	import Document from '$lib/components/icons/Document.svelte';
	import Folder from '$lib/components/icons/Folder.svelte';
	import GlobeAlt from '$lib/components/icons/GlobeAlt.svelte';
	import XMark from '$lib/components/icons/XMark.svelte';

	import type { WorkspaceTab } from './workspace';

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
	let closeButtonElement: HTMLButtonElement;
	const getTabElements = () =>
		Array.from(tabListElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? []);

	const iconKind = (kind: string) => {
		if (kind === 'canvas-note') return 'document';
		if (kind === 'workspace-file') return 'file';
		if (kind === 'web-preview') return 'browser';
		if (kind.includes('browser')) return 'browser';
		if (kind.includes('file')) return 'files';
		if (kind.includes('jira') || kind.includes('confluence') || kind.includes('bitbucket')) {
			return 'connector';
		}
		return 'code';
	};

	const fileIconTone = (name: string) => {
		const extension = name.split('.').pop()?.toLowerCase() ?? '';
		if (['doc', 'docx', 'odt'].includes(extension)) return 'text-blue-600 dark:text-blue-400';
		if (['ppt', 'pptx'].includes(extension)) return 'text-orange-600 dark:text-orange-400';
		if (['xls', 'xlsx', 'ods', 'csv', 'tsv'].includes(extension)) {
			return 'text-emerald-600 dark:text-emerald-400';
		}
		if (extension === 'pdf') return 'text-red-600 dark:text-red-400';
		return 'text-gray-400 group-hover:text-gray-600 dark:group-hover:text-gray-300';
	};

	// Select before the active editor can consume the pointer's final click.
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
		const currentIndex = tabs.findIndex((item) => item.id === tab.id);
		let nextIndex = currentIndex;
		if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % tabs.length;
		else if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
		else if (event.key === 'Home') nextIndex = 0;
		else if (event.key === 'End') nextIndex = tabs.length - 1;
		else return;

		event.preventDefault();
		const nextTab = tabs[nextIndex];
		if (!nextTab) return;
		await selectTab(nextTab);
		await tick();
		Array.from(tabListElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? [])[
			nextIndex
		]?.focus();
	};

	const closeTabAndFocus = async (tab: WorkspaceTab) => {
		const closedIndex = tabs.findIndex((item) => item.id === tab.id);
		await onCloseTab(tab);
		await tick();
		const remainingTabs = getTabElements();
		if (remainingTabs.length) {
			remainingTabs[Math.min(Math.max(closedIndex, 0), remainingTabs.length - 1)]?.focus();
		} else {
			(
				document.querySelector<HTMLButtonElement>(
					'#artifacts-container [data-testid="workspace-empty-header"] button'
				) ?? closeButtonElement
			)?.focus();
		}
	};

	const finishTabDrag = () => {
		draggedTabId = '';
		dragTargetId = '';
		pressedTabId = '';
	};

	const beginTabMouse = (event: MouseEvent, tab: WorkspaceTab) => {
		if (event.button !== 0) return;
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
			window.removeEventListener('mousemove', move);
			window.removeEventListener('mouseup', end);
			if (draggedTabId && dragTargetId && draggedTabId !== dragTargetId) {
				onReorder(draggedTabId, dragTargetId);
			}
			finishTabDrag();
		};

		window.addEventListener('mousemove', move, { passive: false });
		window.addEventListener('mouseup', end, { once: true });
	};
</script>

<div
	class="workspace-tabs shrink-0 border-b border-gray-100 bg-white px-2 py-1.5 dark:border-gray-800 dark:bg-gray-850"
	data-testid="workspace-tabs"
>
	<div class="flex min-h-8 items-center gap-1">
		<div
			bind:this={tabListElement}
			class="scrollbar-hidden flex min-w-0 flex-1 items-center gap-1 overflow-x-auto"
			role="tablist"
			aria-label={$i18n.t('Open documents')}
		>
			{#each tabs as tab (tab.id)}
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
							class="shrink-0 {iconKind(tab.kind) === 'file'
								? fileIconTone(tab.title)
								: 'text-gray-400 group-hover:text-gray-600 dark:group-hover:text-gray-300'}"
							data-workspace-icon={iconKind(tab.kind) === 'file'
								? fileIconName(tab.title)
								: iconKind(tab.kind)}
						>
							{#if iconKind(tab.kind) === 'file'}
								<Icon name={fileIconName(tab.title)} size={16} strokeWidth={1.5} />
							{:else if iconKind(tab.kind) === 'document'}
								<Document className="size-4" />
							{:else if iconKind(tab.kind) === 'files'}
								<Folder className="size-4" />
							{:else if ['browser', 'connector'].includes(iconKind(tab.kind))}
								<GlobeAlt className="size-4" />
							{:else}
								<CodeBracket className="size-4" />
							{/if}
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
