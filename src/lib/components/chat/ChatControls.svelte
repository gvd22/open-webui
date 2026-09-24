<script context="module" lang="ts">
	let savedTab: 'controls' | 'files' | 'overview' = 'controls';
</script>

<script lang="ts">
	import { onMount, getContext } from 'svelte';
	import { SHOW_UPSTREAM_CHAT_CONTROLS, ENABLE_CHAT_TERMINALS } from '$lib/chatUi';
	import { isSavedChatId } from '$lib/utils/chatId';
	import {
		config,
		terminalServers,
		selectedTerminalId,
		user,
		showControls,
		showCallOverlay,
		showArtifacts,
		showEmbeds,
		showFileNavPath,
		artifactCode
	} from '$lib/stores';
	import Controls from './Controls/Controls.svelte';
	import FileNav from './FileNav.svelte';
	import PyodideFileNav from './PyodideFileNav.svelte';
	import Overview from './Overview.svelte';
	import CallOverlay from './MessageInput/CallOverlay.svelte';
	import Drawer from '../common/Drawer.svelte';
	import ResizableSidePanel from '../common/ResizableSidePanel.svelte';
	import Artifacts from './Artifacts.svelte';
	import Embeds from './ChatControls/Embeds.svelte';
	import {
		getDefaultWorkspaceContentId,
		isWorkspaceOpenRequestForChat,
		WORKSPACE_FILES_ID
	} from './Artifacts/workspace';

	const i18n = getContext('i18n');

	export let models = [];
	export let chatUser = null;
	export let chatFiles = [];
	export let params = {};
	export let showMessage: Function;
	export let history: Record<string, any> | null = null;
	export let chatId: string | null = null;
	export let eventTarget: EventTarget;
	export let submitPrompt: Function;
	export let stopResponse: Function;
	export let files: any[] = [];
	export let modelId: string | null = null;
	export let codeInterpreterEnabled = false;

	let largeScreen = false;
	let resizing = false;
	let controlsWidth = 600;
	$: pyodideFilesAvailable =
		codeInterpreterEnabled && $config?.code?.interpreter_engine !== 'jupyter';

	// Tab state for Controls+Files panel
	let activeTab = savedTab;
	// svelte-ignore reactive_declaration_module_script_dependency
	$: {
		savedTab = activeTab;
	}

	$: hasMessages = history?.messages && Object.keys(history.messages).length > 0;

	$: showControlsTab = $user?.role === 'admin' || ($user?.permissions?.chat?.controls ?? true);
	const chatContext = (terminal: any) => terminal?.contexts?.chat ?? {};
	const chatContextAvailable = (terminal: any) => chatContext(terminal) !== false;
	const chatContextNeedsSavedChat = (terminal: any) =>
		chatContext(terminal)?.context_id === 'chat_id';
	$: selectedSystemTerminal = ($terminalServers ?? []).find(
		(t) => t.id && t.id === $selectedTerminalId
	);
	$: selectedSystemTerminalAvailable =
		selectedSystemTerminal &&
		chatContextAvailable(selectedSystemTerminal) &&
		!(chatContextNeedsSavedChat(selectedSystemTerminal) && !isSavedChatId(chatId));
	$: terminalFilesAvailable =
		ENABLE_CHAT_TERMINALS &&
		!!(
			$selectedTerminalId &&
			(selectedSystemTerminalAvailable ||
				(!selectedSystemTerminal &&
					($user?.role === 'admin' || ($user?.permissions?.features?.direct_tool_servers ?? true))))
		);
	$: showFilesTab =
		terminalFilesAvailable ||
		(codeInterpreterEnabled && $config?.code?.interpreter_engine !== 'jupyter');
	$: showOverviewTab = hasMessages;

	// Tab fallback: if active tab becomes hidden, switch to next available
	$: if (!showOverviewTab && activeTab === 'overview') activeTab = 'controls';
	$: if (!showFilesTab && activeTab === 'files') activeTab = 'controls';
	$: if (!showControlsTab && activeTab === 'controls') {
		if (showFilesTab) activeTab = 'files';
		else if (showOverviewTab) activeTab = 'overview';
	}

	// Auto-close if there are no visible tabs
	$: if (SHOW_UPSTREAM_CHAT_CONTROLS && !showControlsTab && !showFilesTab && !showOverviewTab) {
		showControls.set(false);
	}

	// Auto-switch to Files tab when display_file is triggered
	$: if ($showFileNavPath && terminalFilesAvailable) {
		activeTab = 'files';
		showControls.set(true);
	}

	// Keep Files selected when a terminal is active; opening the panel is handled by selection UI.
	$: if ($selectedTerminalId && terminalFilesAvailable) {
		activeTab = 'files';
	}

	// Clear selected direct terminal if user lost permission
	$: if (
		ENABLE_CHAT_TERMINALS &&
		$selectedTerminalId &&
		$terminalServers !== null &&
		!($terminalServers ?? []).some((t) => t.id && t.id === $selectedTerminalId) &&
		!($user?.role === 'admin' || ($user?.permissions?.features?.direct_tool_servers ?? true))
	) {
		selectedTerminalId.set(null);
	}

	const openWorkspaceItem = (id: string) => {
		artifactCode.set(id);
		showArtifacts.set(true);
		showControls.set(true);
	};

	$: if (
		!SHOW_UPSTREAM_CHAT_CONTROLS &&
		$showControls &&
		!$showCallOverlay &&
		!$showEmbeds &&
		!$showArtifacts &&
		!$showFileNavPath
	) {
		openWorkspaceItem(getDefaultWorkspaceContentId());
	}
	$: if ($showFileNavPath) {
		if (
			typeof $showFileNavPath === 'object' &&
			!isWorkspaceOpenRequestForChat($showFileNavPath.chatId, chatId)
		) {
			showFileNavPath.set(null);
		} else if (typeof $showFileNavPath === 'object' && $showFileNavPath.fileId) {
			showArtifacts.set(true);
			showControls.set(true);
		} else {
			openWorkspaceItem(WORKSPACE_FILES_ID);
		}
	}

	const closeHandler = () => {
		showControls.set(false);
		showArtifacts.set(false);
		showEmbeds.set(false);
		showCallOverlay.set(false);
	};

	onMount(() => {
		const mediaQuery = window.matchMedia('(min-width: 1024px)');
		const update = () => {
			largeScreen = mediaQuery.matches;
		};
		mediaQuery.addEventListener('change', update);
		update();
		return () => {
			mediaQuery.removeEventListener('change', update);
		};
	});
</script>

{#snippet content()}
	<div class="relative h-full min-h-0 overflow-hidden" id="controls-container">
		{#if $showCallOverlay}
			<CallOverlay
				bind:files
				{submitPrompt}
				{stopResponse}
				{modelId}
				{chatId}
				{eventTarget}
				on:close={closeHandler}
			/>
		{:else if $showEmbeds}
			<Embeds overlay={resizing} />
		{:else if $showArtifacts || !SHOW_UPSTREAM_CHAT_CONTROLS}
			<Artifacts {history} overlay={resizing} showFiles={pyodideFilesAvailable} />
		{:else}
			<!-- Controls + Files tabs -->
			<div class="flex flex-col h-full min-h-0">
				<!-- Tab bar -->
				<div class="flex items-center justify-between px-2 pt-2 pb-2 shrink-0">
					<div class="flex gap-1 min-w-0 overflow-x-auto scrollbar-hidden">
						{#if showControlsTab}
							<button
								class="px-2.5 py-1 text-sm rounded-lg transition whitespace-nowrap {activeTab ===
								'controls'
									? 'bg-gray-100/40 dark:bg-gray-800/25 font-normal text-gray-700 dark:text-gray-200'
									: 'text-gray-500 dark:text-gray-400 hover:bg-gray-100/30 dark:hover:bg-gray-800/20 hover:text-gray-600 dark:hover:text-gray-300'}"
								on:click={() => (activeTab = 'controls')}
							>
								{$i18n.t('Controls')}
							</button>
						{/if}
						{#if showFilesTab}
							<button
								class="px-2.5 py-1 text-sm rounded-lg transition whitespace-nowrap {activeTab ===
								'files'
									? 'bg-gray-100/40 dark:bg-gray-800/25 font-normal text-gray-700 dark:text-gray-200'
									: 'text-gray-500 dark:text-gray-400 hover:bg-gray-100/30 dark:hover:bg-gray-800/20 hover:text-gray-600 dark:hover:text-gray-300'}"
								on:click={() => (activeTab = 'files')}
							>
								{$i18n.t('Files')}
							</button>
						{/if}
						{#if showOverviewTab}
							<button
								class="px-2.5 py-1 text-sm rounded-lg transition whitespace-nowrap {activeTab ===
								'overview'
									? 'bg-gray-100/40 dark:bg-gray-800/25 font-normal text-gray-700 dark:text-gray-200'
									: 'text-gray-500 dark:text-gray-400 hover:bg-gray-100/30 dark:hover:bg-gray-800/20 hover:text-gray-600 dark:hover:text-gray-300'}"
								on:click={() => (activeTab = 'overview')}
							>
								{$i18n.t('Overview')}
							</button>
						{/if}
					</div>
					<button
						class="p-1 rounded-lg text-gray-500 dark:text-gray-400"
						on:click={() => showControls.set(false)}
						aria-label={$i18n.t('Close')}
					>
						<svg
							xmlns="http://www.w3.org/2000/svg"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="1.5"
							class="size-4"
						>
							<path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" />
						</svg>
					</button>
				</div>

				<div
					class="flex-1 min-h-0 {activeTab === 'overview'
						? 'h-full'
						: activeTab === 'controls'
							? 'overflow-y-auto px-3 pt-1'
							: ''}"
				>
					{#if activeTab === 'overview'}
						<Overview
							{history}
							{chatUser}
							onNodeClick={(e) => {
								const node = e.node;
								if (node?.data?.message?.favorite) {
									history.messages[node.data.message.id].favorite = true;
								} else {
									history.messages[node.data.message.id].favorite = null;
								}
								showMessage(node.data.message, true);
							}}
						/>
					{:else if activeTab === 'files' && terminalFilesAvailable && $selectedTerminalId}
						<FileNav overlay={resizing} {chatId} />
					{:else if activeTab === 'files' && codeInterpreterEnabled}
						<PyodideFileNav overlay={resizing} />
					{:else}
						<Controls embed={true} {models} bind:chatFiles bind:params />
					{/if}
				</div>
			</div>
		{/if}
	</div>
{/snippet}

{#if !largeScreen}
	{#if $showControls}
		<Drawer
			show={$showControls}
			onClose={closeHandler}
			className="min-h-[100dvh] !bg-white dark:!bg-gray-850"
		>
			<div class="h-[100dvh]">{@render content()}</div>
		</Drawer>
	{/if}
{:else}
	<ResizableSidePanel
		open={$showControls}
		bind:width={controlsWidth}
		bind:isResizing={resizing}
		side="right"
		minWidth={350}
		minSiblingWidth={360}
		closeOnDragBelowMinWidth
		onClose={closeHandler}
		storageKey="chatControlsSize"
		className="h-full z-10 bg-white dark:bg-gray-900"
	>
		{@render content()}
	</ResizableSidePanel>
{/if}
