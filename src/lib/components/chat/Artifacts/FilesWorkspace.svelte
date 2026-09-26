<script context="module" lang="ts">
	let unsavedFiles: import('./workspace').WorkspaceFileContent[] = [];
</script>

<script lang="ts">
	import { fileText } from '$lib/components/chat/Artifacts/fileText';
	import { getContext, onMount } from 'svelte';
	import { toast } from 'svelte-sonner';
	import { chatId, config, showControls, showFileNavPath } from '$lib/stores';
	import { showFilesWorkspace } from '$lib/stores/fileWorkspace';
	import FileBrowser from './FileBrowser.svelte';
	import WorkspaceTabs from './WorkspaceTabs.svelte';
	import WorkspaceDocumentPanels from './WorkspaceDocumentPanels.svelte';
	import { readWorkspaceState, writeWorkspaceState } from './workspaceSession';
	import {
		buildWorkspaceFileContent,
		buildWorkspaceTabs,
		getWorkspaceFileId,
		getWorkspaceDocumentFormat,
		isWorkspaceOpenRequestForChat,
		upsertWorkspaceFileContent,
		WORKSPACE_FILES_ID,
		type WorkspaceContent,
		type WorkspaceFileContent,
		type WorkspaceTab
	} from './workspace';

	const i18n: import('svelte/store').Writable<import('i18next').i18n> = getContext('i18n');
	export let overlay = false;
	let files: WorkspaceFileContent[] = [];
	let selectedId = WORKSPACE_FILES_ID;
	let contextId = '';
	let mounted = false;
	let persistenceWarningShown = false;
	$: viewerEnabled = $config?.features?.enable_document_viewer === true;
	$: contents = [
		{ type: 'workspace-files', workspaceId: WORKSPACE_FILES_ID, title: 'Files', content: '' },
		...files.filter((file) => !file.fileFormat || viewerEnabled)
	] as WorkspaceContent[];
	$: selectedIndex = Math.max(
		0,
		contents.findIndex((content) => content.workspaceId === selectedId)
	);
	$: activeContent = contents[selectedIndex];

	function persist() {
		if (!contextId) {
			unsavedFiles = files;
			return;
		}
		const saved = writeWorkspaceState(contextId, {
			order: files.map((file) => file.workspaceId),
			closed: [],
			filesOpened: true,
			openedFiles: files.map(({ path, fileId }) => ({ path, ...(fileId ? { fileId } : {}) }))
		});
		if (!saved && !persistenceWarningShown) {
			persistenceWarningShown = true;
			toast.error(fileText($i18n, 'Workspace layout could not be saved'));
		}
	}

	function restore(id: string) {
		contextId = id;
		const state = readWorkspaceState(id);
		const order = new Map((state?.order ?? []).map((key, index) => [key, index]));
		files = (state?.openedFiles ?? [])
			.map(({ path, fileId }) => buildWorkspaceFileContent(path, undefined, fileId))
			.filter((file) => !state?.closed.includes(file.workspaceId))
			.sort(
				(a, b) => (order.get(a.workspaceId) ?? Infinity) - (order.get(b.workspaceId) ?? Infinity)
			);
		if (!id) files = unsavedFiles;
		selectedId = WORKSPACE_FILES_ID;
		persistenceWarningShown = false;
	}

	function openFile(path: string, options: { page?: number | null; fileId?: string | null } = {}) {
		if (getWorkspaceDocumentFormat(path) && !viewerEnabled) return false;
		files = upsertWorkspaceFileContent(files, path, options.page, options.fileId);
		selectedId = getWorkspaceFileId(path);
		persist();
		return true;
	}

	function closeTab(tab: WorkspaceTab) {
		if (!tab.closable) return;
		const index = files.findIndex((file) => file.workspaceId === tab.id);
		files = files.filter((file) => file.workspaceId !== tab.id);
		if (selectedId === tab.id)
			selectedId = files[Math.max(0, index - 1)]?.workspaceId ?? WORKSPACE_FILES_ID;
		persist();
	}

	function reorder(sourceId: string, targetId: string) {
		const from = files.findIndex((file) => file.workspaceId === sourceId);
		const to = files.findIndex((file) => file.workspaceId === targetId);
		if (from < 0 || to < 0 || from === to) return;
		const reordered = [...files];
		const [file] = reordered.splice(from, 1);
		reordered.splice(to, 0, file);
		files = reordered;
		persist();
	}

	function close() {
		persist();
		showFilesWorkspace.set(false);
		showControls.set(false);
	}

	onMount(() => {
		restore($chatId ?? '');
		mounted = true;
	});
	$: if (mounted && ($chatId ?? '') !== contextId) {
		if (!contextId && $chatId && files.length) {
			contextId = $chatId;
			persist();
			unsavedFiles = [];
		} else restore($chatId ?? '');
	}
	$: if (mounted && typeof $showFileNavPath === 'object' && $showFileNavPath?.fileId) {
		const request = $showFileNavPath;
		showFileNavPath.set(null);
		if (isWorkspaceOpenRequestForChat(request.chatId, $chatId)) openFile(request.path, request);
	}
</script>

<div
	class="relative flex h-full min-h-0 min-w-0 flex-col bg-white dark:bg-gray-850"
	id="files-workspace"
>
	<WorkspaceTabs
		tabs={buildWorkspaceTabs(contents)}
		{selectedIndex}
		onSelect={(tab) => {
			selectedId = tab.id;
		}}
		onCloseTab={closeTab}
		onReorder={reorder}
		onClose={close}
	/>
	<div class="relative min-h-0 flex-1">
		<div
			id="workspace-panel-0"
			role="tabpanel"
			aria-labelledby="workspace-tab-0"
			hidden={selectedIndex !== 0}
			class="absolute inset-0"
		>
			<FileBrowser {overlay} onOpenFile={openFile} />
		</div>
		<WorkspaceDocumentPanels {contents} selectedContentId={activeContent.workspaceId} />
		{#if overlay}<div class="absolute inset-0 z-30"></div>{/if}
	</div>
</div>
