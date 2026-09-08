<script lang="ts">
	import { onMount } from 'svelte';
	import {
		config,
		showControls,
		showCallOverlay,
		showArtifacts,
		showEmbeds,
		showFileNavPath,
		artifactCode
	} from '$lib/stores';
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

	const openWorkspaceItem = (id: string) => {
		artifactCode.set(id);
		showArtifacts.set(true);
		showControls.set(true);
	};

	$: if (
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
		{:else}
			<Artifacts {history} overlay={resizing} showFiles={pyodideFilesAvailable} />
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
