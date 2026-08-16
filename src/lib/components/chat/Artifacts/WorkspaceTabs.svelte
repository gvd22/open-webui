<script lang="ts">
	import { getContext } from 'svelte';

	import CodeBracket from '$lib/components/icons/CodeBracket.svelte';
	import Document from '$lib/components/icons/Document.svelte';
	import Folder from '$lib/components/icons/Folder.svelte';
	import GlobeAlt from '$lib/components/icons/GlobeAlt.svelte';
	import Plus from '$lib/components/icons/Plus.svelte';
	import Terminal from '$lib/components/icons/Terminal.svelte';
	import XMark from '$lib/components/icons/XMark.svelte';

	import {
		hasWorkspaceAddActions,
		isKeyboardActivationClick,
		type WorkspaceTab
	} from './workspace';

	const i18n = getContext('i18n');

	export let tabs: WorkspaceTab[] = [];
	export let selectedIndex = 0;
	export let terminalId: string | null = null;
	export let filesAvailable = false;
	export let onSelect: (tab: WorkspaceTab) => void | Promise<void> = () => {};
	export let onClose: () => void = () => {};
	export let onCloseTab: (tab: WorkspaceTab) => void = () => {};
	export let onReorder: (sourceId: string, targetId: string) => void = () => {};
	export let onOpenFiles: () => void = () => {};
	export let onOpenTerminal: () => void = () => {};
	export let onOpenBrowser: () => void = () => {};
	let showAddMenu = false;
	let draggedTabId = '';
	let dragTargetId = '';
	let pressedTabId = '';
	let pointerStart = { x: 0, y: 0 };
	$: hasAddActions = hasWorkspaceAddActions(terminalId, filesAvailable);

	const onKeyboardClick = (event: MouseEvent, action: () => void) => {
		if (isKeyboardActivationClick(event.detail)) action();
	};

	const closeAddMenuOnEscape = (event: KeyboardEvent) => {
		if (event.key === 'Escape') showAddMenu = false;
	};
	const closeAddMenuOnPointer = () => {
		if (showAddMenu) showAddMenu = false;
	};
	const keepAddMenuOpen = () => {};

	const iconKind = (kind: string) => {
		if (kind === 'canvas-note') return 'document';
		if (kind === 'workspace-file') return 'document';
		if (kind === 'web-preview') return 'browser';
		if (kind.includes('terminal')) return 'terminal';
		if (kind.includes('browser')) return 'browser';
		if (kind.includes('file')) return 'files';
		if (kind.includes('jira') || kind.includes('confluence') || kind.includes('bitbucket')) {
			return 'connector';
		}
		return 'code';
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

	const openFiles = () => {
		if (filesAvailable) onOpenFiles();
	};

	const openTerminal = () => {
		if (!terminalId) return;
		onOpenTerminal();
	};

	const openBrowser = () => onOpenBrowser();
	const finishMenuAction = (action: () => void) => {
		action();
		showAddMenu = false;
	};

	const finishTabDrag = () => {
		draggedTabId = '';
		dragTargetId = '';
		pressedTabId = '';
	};

	const beginTabMouse = (event: MouseEvent, tab: WorkspaceTab) => {
		if (event.button !== 0) return;
		showAddMenu = false;
		pressedTabId = tab.id;
		pointerStart = { x: event.clientX, y: event.clientY };
		// Select on pointer-down so an active preview cannot consume the final click.
		// The drag listeners below still handle reordering after the pointer moves.
		void selectTab(tab);

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
			} else if (!draggedTabId) {
				void selectTab(tab);
			}
			finishTabDrag();
		};

		window.addEventListener('mousemove', move, { passive: false });
		window.addEventListener('mouseup', end, { once: true });
	};
</script>

<svelte:window on:mousedown={closeAddMenuOnPointer} on:keydown={closeAddMenuOnEscape} />

<div
	class="workspace-tabs shrink-0 border-b border-gray-100 bg-white px-2 py-1.5 dark:border-gray-800 dark:bg-gray-850"
	data-testid="workspace-tabs"
>
	<div class="flex min-h-8 items-center gap-1">
		<div
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
						aria-selected={tab.index === selectedIndex}
						aria-controls="workspace-active-content"
						title={tab.title}
						data-workspace-id={tab.id}
						class="flex h-8 w-full min-w-0 items-center gap-2 px-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-400 dark:focus-visible:ring-gray-500 {tab.closable
							? 'pr-8'
							: 'pr-3'}"
						on:mousedown|stopPropagation={(event) => beginTabMouse(event, tab)}
						on:click|stopPropagation={() => void selectTab(tab)}
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
							on:click|preventDefault|stopPropagation={() => onCloseTab(tab)}
						>
							<XMark className="size-3.5" />
						</button>
					{/if}
				</div>
			{/each}
		</div>

		{#if hasAddActions}
			<div class="relative shrink-0">
				<button
					type="button"
					class="flex size-8 items-center justify-center rounded-md text-gray-500 transition hover:bg-gray-100 hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-400 disabled:cursor-default disabled:opacity-30 disabled:hover:bg-transparent dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white dark:focus-visible:ring-gray-500 dark:disabled:hover:bg-transparent"
					aria-label={$i18n.t('Add to workspace')}
					aria-haspopup="menu"
					aria-expanded={showAddMenu}
					title={$i18n.t('Add to workspace')}
					on:mousedown|preventDefault|stopPropagation={() => {
						showAddMenu = !showAddMenu;
					}}
					on:click|stopPropagation={(event) =>
						onKeyboardClick(event, () => {
							showAddMenu = !showAddMenu;
						})}
				>
					<Plus className="size-4" strokeWidth="1.7" />
				</button>

				{#if showAddMenu}
					<div
						class="absolute right-0 top-9 z-50 min-w-44 rounded-lg border border-gray-100 bg-white p-1 text-sm shadow-lg dark:border-gray-700 dark:bg-gray-850"
						role="menu"
						tabindex="-1"
						on:mousedown|stopPropagation={keepAddMenuOpen}
					>
						{#if terminalId}
							<button
								type="button"
								class="flex h-9 w-full items-center gap-2 rounded-md px-2.5 text-left text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800"
								on:mousedown|preventDefault|stopPropagation={keepAddMenuOpen}
								on:click|stopPropagation={() => finishMenuAction(openTerminal)}
							>
								<Terminal className="size-4" />
								<span>{$i18n.t('Terminal')}</span>
							</button>
							<button
								type="button"
								class="flex h-9 w-full items-center gap-2 rounded-md px-2.5 text-left text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800"
								on:mousedown|preventDefault|stopPropagation={keepAddMenuOpen}
								on:click|stopPropagation={() => finishMenuAction(openBrowser)}
							>
								<GlobeAlt className="size-4" />
								<span>{$i18n.t('Browser')}</span>
							</button>
						{/if}
						{#if filesAvailable}
							<button
								type="button"
								class="flex h-9 w-full items-center gap-2 rounded-md px-2.5 text-left text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800"
								on:mousedown|preventDefault|stopPropagation={keepAddMenuOpen}
								on:click|stopPropagation={() => finishMenuAction(openFiles)}
							>
								<Folder className="size-4" />
								<span>{$i18n.t('Files')}</span>
							</button>
						{/if}
					</div>
				{/if}
			</div>
		{/if}

		<button
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
