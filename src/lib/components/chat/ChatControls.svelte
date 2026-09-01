<script lang="ts">
	import { onMount, tick, getContext } from 'svelte';
	import type { Writable } from 'svelte/store';
	import type { i18n as i18nType } from 'i18next';
	import { v4 as uuidv4 } from 'uuid';
	import { toast } from 'svelte-sonner';
	import { uploadFile } from '$lib/apis/files';
	import {
		config, terminalServers, showControls, showCallOverlay, showArtifacts,
		showEmbeds, showFileNavPath, selectedTerminalId, artifactCode,
		workspaceUtilityInstances
	} from '$lib/stores';
	import CallOverlay from './MessageInput/CallOverlay.svelte';
	import Drawer from '../common/Drawer.svelte';
	import ResizableSidePanel from '../common/ResizableSidePanel.svelte';
	import Artifacts from './Artifacts.svelte';
	import XTerminal from './XTerminal.svelte';
	import Embeds from './ChatControls/Embeds.svelte';
	import {
		getDefaultWorkspaceContentId,
		resolveWorkspaceRuntime,
		WORKSPACE_FILES_ID
	} from './Artifacts/workspace';

	const i18n: Writable<i18nType> = getContext('i18n');
	export let history: Record<string, any> | null = null;
	export let models: any[] = [];
	export let chatId: string | null = null;
	export let chatUser: any = null;
	export let chatFiles: any[] = [];
	export let params: Record<string, any> = {};
	export let eventTarget: EventTarget;
	export let submitPrompt: Function;
	export let stopResponse: Function;
	export let showMessage: Function;
	export let files: any[] = [];
	export let modelId: string | null = null;
	export let codeInterpreterEnabled = false;

	let largeScreen = false;
	let resizing = false;
	let controlsWidth = 600;
	let workspaceTerminalComponents: Record<string, XTerminal> = {};

	$: workspaceRuntime = resolveWorkspaceRuntime(
		$terminalServers,
		$selectedTerminalId,
		codeInterpreterEnabled && $config?.code?.interpreter_engine !== 'jupyter',
		chatId
	);

	const openWorkspaceItem = (id: string) => {
		artifactCode.set(id);
		showArtifacts.set(true);
		showControls.set(true);
	};

	$: if ($showControls && !$showCallOverlay && !$showEmbeds && !$showArtifacts) {
		openWorkspaceItem(getDefaultWorkspaceContentId(workspaceRuntime));
	}
	$: if ($showFileNavPath) openWorkspaceItem(WORKSPACE_FILES_ID);

	const handleTerminalAttach = async (blob: Blob, name: string, contentType: string) => {
		const itemId = uuidv4();
		const pending = {
			type: 'file', file: '', id: null, url: '', name,
			collection_name: '', status: 'uploading', error: '', itemId, size: blob.size
		};
		files = [...files, pending];
		try {
			const file = new File([blob], name, { type: contentType || 'application/octet-stream' });
			const uploaded = await uploadFile(localStorage.token, file);
			if (!uploaded) throw new Error('Upload failed');
			files = files.map((item) => item.itemId !== itemId ? item : {
				...pending, status: 'uploaded', file: uploaded, id: uploaded.id,
				url: uploaded.id, collection_name: uploaded?.meta?.collection_name
			});
			toast.success($i18n.t('File attached to chat'));
		} catch {
			files = files.filter((item) => item.itemId !== itemId);
			toast.error($i18n.t('Failed to attach file'));
		}
	};

	const closeHandler = () => {
		showControls.set(false);
		showArtifacts.set(false);
		showEmbeds.set(false);
		showCallOverlay.set(false);
	};

	onMount(() => {
		const mediaQuery = window.matchMedia('(min-width: 1024px)');
		const update = () => { largeScreen = mediaQuery.matches; };
		mediaQuery.addEventListener('change', update);
		update();
		return () => {
			mediaQuery.removeEventListener('change', update);
		};
	});

	$: activeWorkspaceTerminal = $workspaceUtilityInstances.find(
		(instance) => instance.kind === 'terminal' && instance.id === $artifactCode
	);
	$: if (activeWorkspaceTerminal && workspaceTerminalComponents[activeWorkspaceTerminal.id]) {
		const id = activeWorkspaceTerminal.id;
		void tick().then(() => workspaceTerminalComponents[id]?.focus());
	}
</script>

{#snippet content()}
	<div class="relative h-full min-h-0 overflow-hidden" id="controls-container">
		{#if $showCallOverlay}
			<CallOverlay
				bind:files {submitPrompt} {stopResponse} {modelId} {chatId} {eventTarget}
				on:close={closeHandler}
			/>
		{:else if $showEmbeds}
			<Embeds overlay={resizing} />
		{:else}
			<Artifacts
				{history} overlay={resizing} showFiles={workspaceRuntime.files}
				{codeInterpreterEnabled} onAttach={handleTerminalAttach}
			/>
			{#each $workspaceUtilityInstances.filter((instance) => instance.kind === 'terminal') as instance (instance.id)}
				<div
					class="absolute inset-x-0 bottom-0 top-11 z-10 bg-black"
					class:invisible={$artifactCode !== instance.id}
					class:pointer-events-none={$artifactCode !== instance.id}
				>
					<XTerminal
						bind:this={workspaceTerminalComponents[instance.id]}
						{chatId} terminalId={instance.terminalId}
					/>
				</div>
			{/each}
		{/if}
	</div>
{/snippet}

{#if !largeScreen}
	{#if $showControls}
		<Drawer
			show={$showControls} onClose={closeHandler}
			className="min-h-[100dvh] !bg-white dark:!bg-gray-850"
		>
			<div class="h-[100dvh]">{@render content()}</div>
		</Drawer>
	{/if}
{:else}
	<ResizableSidePanel
		open={$showControls} bind:width={controlsWidth} bind:isResizing={resizing}
		side="right"
		minWidth={350} minSiblingWidth={360} closeOnDragBelowMinWidth
		onClose={closeHandler} storageKey="chatControlsSize"
		className="h-full z-10 bg-white dark:bg-gray-900"
	>
		{@render content()}
	</ResizableSidePanel>
{/if}
