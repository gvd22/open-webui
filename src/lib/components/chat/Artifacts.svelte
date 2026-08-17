<script lang="ts">
	import { toast } from 'svelte-sonner';
	import { onMount, onDestroy, getContext, createEventDispatcher } from 'svelte';
	const i18n = getContext('i18n');
	const dispatch = createEventDispatcher();

	import {
		artifactCode,
		chatId,
		config,
		settings,
		showArtifacts,
		showControls,
		artifactContents,
		selectedTerminalId,
		terminalServers,
		workspaceChatContextId,
		workspaceOpenRequestId,
		workspaceTerminalConnectionId,
		workspaceUtilityInstances,
		workspaceActiveFile,
		workspaceOpenFilePaths
	} from '$lib/stores';
	import { copyToClipboard, createMessagesList } from '$lib/utils';
	import { injectCsp } from '$lib/utils/csp';

	import XMark from '../icons/XMark.svelte';
	import ArrowsPointingOut from '../icons/ArrowsPointingOut.svelte';
	import Tooltip from '../common/Tooltip.svelte';
	import SvgPanZoom from '../common/SVGPanZoom.svelte';
	import ArrowLeft from '../icons/ArrowLeft.svelte';
	import Download from '../icons/Download.svelte';
	import NoteCanvas from './Artifacts/NoteCanvas.svelte';
	import FileNav from './FileNav.svelte';
	import PyodideFileNav from './PyodideFileNav.svelte';
	import WorkspaceTabs from './Artifacts/WorkspaceTabs.svelte';
	import WorkspaceBrowser from './Artifacts/WorkspaceBrowser.svelte';
	import WorkspaceLauncher from './Artifacts/WorkspaceLauncher.svelte';
	import WebPreviewRenderer from './Artifacts/WebPreviewRenderer.svelte';
	import WorkspaceDocumentPanels from './Artifacts/WorkspaceDocumentPanels.svelte';
	import { getCanvasNoteArtifactsFromHistory } from './Artifacts/canvas';
	import { getWebPreviewsFromHistory } from './Artifacts/webPreview';
	import { selectTransientCanvasDocument } from '$lib/apis/chats';
	import {
		buildWorkspaceTabs,
		buildWorkspaceFileContent,
		upsertWorkspaceFileContent,
		limitWorkspaceFileContents,
		buildWorkspaceUtilityContents,
		getWorkspaceDocumentFormatForViewer,
		getWorkspaceContentId,
		getWorkspaceInstanceId,
		getNextWorkspaceInstanceTitle,
		getVisibleWorkspaceContents,
		moveWorkspaceContent,
		orderWorkspaceContents,
		resolveWorkspaceRuntime,
		shouldShowWorkspaceTabs,
		shouldResetWorkspaceForChatChange,
		type WorkspaceContent,
		type WorkspaceTab,
		WORKSPACE_FILES_ID,
		WORKSPACE_TERMINAL_ID,
		WORKSPACE_BROWSER_ID,
		WORKSPACE_LAUNCHER_ID
	} from './Artifacts/workspace';

	export let overlay = false;
	export let history = null;
	export let showFiles = false;
	export let codeInterpreterEnabled = false;
	export let onAttach: ((blob: Blob, name: string, contentType: string) => void) | null = null;

	let artifactSourceContents: WorkspaceContent[] = [];
	let openedFileContents: WorkspaceContent[] = [];
	let filesOpened = false;
	let sourceContents: WorkspaceContent[] = [];
	let contents: WorkspaceContent[] = [];
	let workspaceContentOrder: string[] = [];
	let selectedContentIdx = 0;
	let closedWorkspaceContentIds = new Set<string>();
	let activeFileContextKey = '';
	let openedFileRuntimeKey = '';
	let openedFileRecency: string[] = [];
	let activeOpenedFileId = '';
	let queuedFileFocusId = '';
	let fileFocusQueued = false;
	const WORKSPACE_STATE_VERSION = 1;
	const workspaceStateKey = (id: string) =>
		`open-webui.workspace.tabs.v${WORKSPACE_STATE_VERSION}:${id}`;

	type PersistedWorkspaceState = {
		version: number;
		order: string[];
		closed: string[];
		filesOpened: boolean;
		openedFiles: string[];
		utilities: Array<{
			id: string;
			kind: 'terminal' | 'browser';
			title: string;
			terminalId?: string;
		}>;
	};

	const readWorkspaceState = (id: string): PersistedWorkspaceState | null => {
		if (!id) return null;
		try {
			const value = JSON.parse(localStorage.getItem(workspaceStateKey(id)) ?? 'null');
			if (!value || value.version !== WORKSPACE_STATE_VERSION) return null;
			return {
				version: WORKSPACE_STATE_VERSION,
				order: Array.isArray(value.order)
					? value.order.filter((item: unknown) => typeof item === 'string').slice(0, 100)
					: [],
				closed: Array.isArray(value.closed)
					? value.closed
							.filter((item: unknown) => typeof item === 'string' && item !== WORKSPACE_LAUNCHER_ID)
							.slice(0, 100)
					: [],
				filesOpened: Boolean(value.filesOpened),
				openedFiles: Array.isArray(value.openedFiles)
					? value.openedFiles.filter((item: unknown) => typeof item === 'string').slice(-4)
					: [],
				utilities: Array.isArray(value.utilities)
					? value.utilities
							.filter(
								(item: any) =>
									item &&
									typeof item.id === 'string' &&
									item.id !== WORKSPACE_LAUNCHER_ID &&
									['terminal', 'browser'].includes(item.kind) &&
									typeof item.title === 'string'
							)
							.slice(0, 30)
					: []
			};
		} catch {
			return null;
		}
	};

	const persistWorkspaceState = (id = $chatId) => {
		if (!id) return;
		try {
			const state: PersistedWorkspaceState = {
				version: WORKSPACE_STATE_VERSION,
				order: workspaceContentOrder.filter((item) => item !== WORKSPACE_LAUNCHER_ID),
				closed: [...closedWorkspaceContentIds].filter((item) => item !== WORKSPACE_LAUNCHER_ID),
				filesOpened,
				openedFiles: openedFileContents.map((content) => content.path).filter(Boolean) as string[],
				utilities: $workspaceUtilityInstances.map(({ id, kind, title, terminalId }) => ({
					id,
					kind,
					title,
					terminalId
				}))
			};
			localStorage.setItem(workspaceStateKey(id), JSON.stringify(state));
		} catch (error) {
			console.warn('Unable to persist workspace tab state', error);
		}
	};

	const restoreWorkspaceState = (id: string) => {
		const state = readWorkspaceState(id);
		closedWorkspaceContentIds = new Set(state?.closed ?? []);
		workspaceContentOrder = state?.order ?? [];
		filesOpened = state?.filesOpened ?? false;
		openedFileContents = (state?.openedFiles ?? []).map(buildWorkspaceFileContent);
		openedFileRecency = openedFileContents.map((content, index) =>
			getWorkspaceContentId(content, index)
		);
		workspaceUtilityInstances.set(state?.utilities ?? []);
	};
	$: selectedContent = contents[selectedContentIdx];
	$: selectedContentId = selectedContent
		? getWorkspaceContentId(selectedContent, selectedContentIdx)
		: '';
	$: workspacePanelId = `workspace-panel-${selectedContentIdx}`;
	$: selectedIsCanvasNote = selectedContent?.type === 'canvas-note';
	$: selectedHasArtifactActions = ['iframe', 'svg'].includes(selectedContent?.type);
	$: workspaceTabs = buildWorkspaceTabs(contents);
	$: hasWorkspaceTabs = shouldShowWorkspaceTabs(contents);

	let copied = false;
	let iframeElement: HTMLIFrameElement;
	const MAX_OPEN_DOCUMENTS = 4;
	$: workspaceRuntime = resolveWorkspaceRuntime(
		$terminalServers,
		$selectedTerminalId,
		showFiles && codeInterpreterEnabled
	);
	$: workspaceTerminalId = workspaceRuntime.terminalId;
	$: workspaceFilesAvailable = showFiles && workspaceRuntime.files;
	$: documentViewerEnabled = $config?.features?.enable_document_viewer === true;
	$: {
		const nextRuntimeKey = `${workspaceRuntime.kind}:${workspaceRuntime.terminalId ?? ''}`;
		if (nextRuntimeKey !== openedFileRuntimeKey) {
			const previousRuntimeKey = openedFileRuntimeKey;
			openedFileRuntimeKey = nextRuntimeKey;
			if (previousRuntimeKey && openedFileContents.length > 0) {
				const previousFileIds = openedFileContents.map((content, index) =>
					getWorkspaceContentId(content, index)
				);
				openedFileContents = [];
				openedFileRecency = [];
				workspaceContentOrder = workspaceContentOrder.filter((id) => !previousFileIds.includes(id));
			}
		}
	}
	$: {
		const activePath =
			selectedContent?.type === 'workspace-file' ? (selectedContent.path ?? '') : '';
		const activeFormat = activePath
			? getWorkspaceDocumentFormatForViewer(activePath, documentViewerEnabled)
			: null;
		const nextContextKey = activePath && activeFormat ? `${activeFormat}:${activePath}` : '';
		if (nextContextKey !== activeFileContextKey) {
			activeFileContextKey = nextContextKey;
			workspaceActiveFile.set(
				activePath && activeFormat ? { path: activePath, format: activeFormat } : null
			);
		}
	}

	function navigateContent(direction: 'prev' | 'next') {
		selectedContentIdx =
			direction === 'prev'
				? Math.max(selectedContentIdx - 1, 0)
				: Math.min(selectedContentIdx + 1, contents.length - 1);
	}

	async function selectWorkspaceContent(index: number) {
		const content = contents[index];
		if (!content) return;

		selectedContentIdx = index;
		artifactCode.set(getWorkspaceContentId(content, index));

		if ($chatId && content.canvasId) {
			try {
				const document = await selectTransientCanvasDocument(
					localStorage.token,
					$chatId,
					content.canvasId
				);
				(artifactContents as any).update((items: any[]) =>
					(items ?? []).map((item) =>
						item?.canvasId === content.canvasId
							? {
									...item,
									title: document.title ?? item.title,
									content: document.content ?? item.content,
									titleEdited: Boolean(document.title_edited),
									updatedAt: document.updated_at ?? item.updatedAt,
									noteId: document.note_id ?? item.noteId
								}
							: item
					)
				);
			} catch {
				toast.error($i18n.t('Canvas focus could not be saved'));
			}
		}
	}

	function syncVisibleWorkspaceContents() {
		const newContents = getVisibleWorkspaceContents(sourceContents, closedWorkspaceContentIds);
		workspaceOpenFilePaths.set(
			newContents
				.filter((content) => content.type === 'workspace-file' && content.path)
				.map((content) => content.path as string)
		);

		if (newContents.length === 0) {
			contents = [];
			selectedContentIdx = 0;
			return;
		}

		const selectedIdx = newContents.findIndex(
			(content, index) =>
				getWorkspaceContentId(content, index) === $artifactCode ||
				content.previewId === $artifactCode ||
				content.canvasId === $artifactCode ||
				content.noteId === $artifactCode
		);
		contents = newContents;
		selectedContentIdx =
			selectedIdx !== -1 ? selectedIdx : Math.min(selectedContentIdx, contents.length - 1);
	}

	function resolveWorkspaceContents(value: WorkspaceContent[] | null) {
		if (value?.length) {
			return value;
		}

		return [
			...getCanvasNoteArtifactsFromHistory(history),
			...getWebPreviewsFromHistory(history)
		] as WorkspaceContent[];
	}

	function rebuildWorkspaceContents() {
		const utilityContents = buildWorkspaceUtilityContents({
			showFiles: showFiles && filesOpened,
			showTerminal: false,
			showBrowser: false
		});
		const utilityInstanceContents: WorkspaceContent[] = $workspaceUtilityInstances.map(
			(instance) => ({
				type: `workspace-${instance.kind}`,
				workspaceId: instance.id,
				title: instance.title,
				terminalId: instance.terminalId,
				content: ''
			})
		);
		const nextSourceContents = [
			...utilityContents.filter((content) => content.workspaceId === WORKSPACE_FILES_ID),
			...artifactSourceContents,
			...(workspaceRuntime.files ? openedFileContents : []),
			...utilityInstanceContents,
			...utilityContents.filter((content) => content.workspaceId !== WORKSPACE_FILES_ID)
		];
		sourceContents = orderWorkspaceContents(nextSourceContents, workspaceContentOrder);
		workspaceContentOrder = sourceContents.map((content, index) =>
			getWorkspaceContentId(content, index)
		);
		syncVisibleWorkspaceContents();
	}

	function ensureWorkspaceFilesOpen() {
		filesOpened = true;
		closedWorkspaceContentIds = new Set(closedWorkspaceContentIds);
		closedWorkspaceContentIds.delete(WORKSPACE_FILES_ID);
		rebuildWorkspaceContents();
		persistWorkspaceState();
	}

	function selectWorkspaceFiles() {
		const filesIndex = contents.findIndex(
			(content, index) => getWorkspaceContentId(content, index) === WORKSPACE_FILES_ID
		);
		if (filesIndex !== -1) selectedContentIdx = filesIndex;
	}

	function openWorkspaceFiles() {
		ensureWorkspaceFilesOpen();
		artifactCode.set(WORKSPACE_FILES_ID);
		selectWorkspaceFiles();
	}

	function openWorkspaceUtility(kind: 'terminal' | 'browser') {
		const terminalId = workspaceTerminalId;
		if (!terminalId) return;

		const instances = $workspaceUtilityInstances;
		const id = getWorkspaceInstanceId(kind, crypto.randomUUID());
		const title = getNextWorkspaceInstanceTitle(
			kind,
			instances.filter((instance) => instance.kind === kind).map((instance) => instance.title)
		);
		workspaceUtilityInstances.set([...instances, { id, kind, title, terminalId }]);
		selectedTerminalId.set(terminalId);
		workspaceTerminalConnectionId.set(terminalId);
		rebuildWorkspaceContents();
		persistWorkspaceState();
		artifactCode.set(id);
	}

	function focusOrOpenWorkspaceUtility(kind: 'terminal' | 'browser') {
		const existing = [...$workspaceUtilityInstances].reverse().find((item) => item.kind === kind);
		if (existing) artifactCode.set(existing.id);
		else openWorkspaceUtility(kind);
	}

	function openWorkspaceFile(path: string): boolean {
		if (
			!workspaceRuntime.files ||
			!getWorkspaceDocumentFormatForViewer(path, documentViewerEnabled)
		) {
			return false;
		}
		const id = `workspace:file:${path}`;
		const nextContents = upsertWorkspaceFileContent(openedFileContents, path);
		const nextRecency = [...openedFileRecency.filter((candidate) => candidate !== id), id];
		const limited = limitWorkspaceFileContents(
			nextContents,
			nextRecency,
			selectedContent?.type === 'workspace-file' ? selectedContentId : '',
			MAX_OPEN_DOCUMENTS
		);
		openedFileContents = limited.contents;
		openedFileRecency = limited.recency;
		workspaceContentOrder = workspaceContentOrder.filter(
			(candidate) => !limited.evictedIds.includes(candidate)
		);
		for (const evictedId of limited.evictedIds) {
			const evicted = nextContents.find(
				(content, index) => getWorkspaceContentId(content, index) === evictedId
			);
			if (evicted) {
				toast.message(
					$i18n.t('Closed {{name}} to keep the workspace responsive.', {
						name: evicted.title ?? 'document'
					})
				);
			}
		}
		closedWorkspaceContentIds = new Set(closedWorkspaceContentIds);
		closedWorkspaceContentIds.delete(id);
		rebuildWorkspaceContents();
		persistWorkspaceState();
		scheduleWorkspaceFileFocus(id);
		return true;
	}

	function touchOpenedFile(id: string) {
		openedFileRecency = [...openedFileRecency.filter((candidate) => candidate !== id), id];
	}

	function scheduleWorkspaceFileFocus(id: string) {
		queuedFileFocusId = id;
		if (fileFocusQueued) return;
		fileFocusQueued = true;
		queueMicrotask(() => {
			fileFocusQueued = false;
			artifactCode.set(queuedFileFocusId);
		});
	}

	function reorderWorkspaceTabs(sourceId: string, targetId: string) {
		sourceContents = moveWorkspaceContent(sourceContents, sourceId, targetId);
		workspaceContentOrder = sourceContents.map((content, index) =>
			getWorkspaceContentId(content, index)
		);
		syncVisibleWorkspaceContents();
		persistWorkspaceState();
	}

	function closeWorkspaceTab(tab: WorkspaceTab) {
		if (tab.id === WORKSPACE_FILES_ID) {
			filesOpened = false;
		}
		if ($workspaceUtilityInstances.some((instance) => instance.id === tab.id)) {
			workspaceUtilityInstances.update((instances) =>
				instances.filter((instance) => instance.id !== tab.id)
			);
			rebuildWorkspaceContents();
		}

		const selectedId = selectedContent
			? getWorkspaceContentId(selectedContent, selectedContentIdx)
			: '';
		closedWorkspaceContentIds = new Set(closedWorkspaceContentIds).add(tab.id);
		openedFileRecency = openedFileRecency.filter((id) => id !== tab.id);
		syncVisibleWorkspaceContents();

		if (contents.length === 0) {
			artifactCode.set(WORKSPACE_LAUNCHER_ID);
			persistWorkspaceState();
			return;
		}

		const selectedIdx = contents.findIndex(
			(content, index) => getWorkspaceContentId(content, index) === selectedId
		);
		selectedContentIdx =
			selectedIdx !== -1 ? selectedIdx : Math.min(tab.index, contents.length - 1);
		const nextContent = contents[selectedContentIdx];
		artifactCode.set(getWorkspaceContentId(nextContent, selectedContentIdx));
		persistWorkspaceState();
	}

	function closeWorkspace() {
		persistWorkspaceState();
		dispatch('close');
		showControls.set(false);
		showArtifacts.set(false);
	}

	const iframeLoadHandler = () => {
		iframeElement.contentWindow.addEventListener(
			'click',
			function (e) {
				const target = e.target.closest('a');
				if (target && target.href) {
					e.preventDefault();
					const url = new URL(target.href, iframeElement.baseURI);
					if (url.origin === window.location.origin) {
						iframeElement.contentWindow.history.pushState(
							null,
							'',
							url.pathname + url.search + url.hash
						);
					} else {
						console.info('External navigation blocked:', url.href);
					}
				}
			},
			true
		);

		// Cancel drag when hovering over iframe
		iframeElement.contentWindow.addEventListener('mouseenter', function (e) {
			e.preventDefault();
			iframeElement.contentWindow.addEventListener('dragstart', (event) => {
				event.preventDefault();
			});
		});
	};

	const showFullScreen = () => {
		if (iframeElement.requestFullscreen) {
			iframeElement.requestFullscreen();
		} else if (iframeElement.webkitRequestFullscreen) {
			iframeElement.webkitRequestFullscreen();
		} else if (iframeElement.msRequestFullscreen) {
			iframeElement.msRequestFullscreen();
		}
	};

	const downloadArtifact = () => {
		const content = contents[selectedContentIdx];
		const blob = new Blob([content.content], { type: 'text/html' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `artifact-${$chatId}-${selectedContentIdx}.html`;
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
		URL.revokeObjectURL(url);
	};

	onMount(() => {
		restoreWorkspaceState($chatId ?? '');
		rebuildWorkspaceContents();

		const unsubscribeArtifactCode = artifactCode.subscribe((value) => {
			if (value === WORKSPACE_FILES_ID) {
				ensureWorkspaceFilesOpen();
				selectWorkspaceFiles();
				return;
			}
			if (value === WORKSPACE_BROWSER_ID) {
				focusOrOpenWorkspaceUtility('browser');
				return;
			}
			if (value === WORKSPACE_TERMINAL_ID) {
				focusOrOpenWorkspaceUtility('terminal');
				return;
			}
			if (contents.length > 0) {
				const codeIdx = contents.findIndex(
					(content, index) =>
						getWorkspaceContentId(content, index) === value ||
						content.previewId === value ||
						content.canvasId === value ||
						content.noteId === value ||
						content.content.includes(value)
				);
				selectedContentIdx = codeIdx !== -1 ? codeIdx : 0;
			}
		});

		const unsubscribeOpenRequest = workspaceOpenRequestId.subscribe((value) => {
			if (!value) return;
			workspaceOpenRequestId.set(null);
			if (closedWorkspaceContentIds.has(value)) {
				closedWorkspaceContentIds = new Set(closedWorkspaceContentIds);
				closedWorkspaceContentIds.delete(value);
				syncVisibleWorkspaceContents();
				persistWorkspaceState();
			}

			const reopenedIndex = contents.findIndex(
				(content, index) => getWorkspaceContentId(content, index) === value
			);
			if (reopenedIndex !== -1) selectedContentIdx = reopenedIndex;
			artifactCode.set(value);
		});

		const unsubscribeArtifactContents = artifactContents.subscribe((value) => {
			artifactSourceContents = resolveWorkspaceContents(value);
			rebuildWorkspaceContents();
		});

		return () => {
			unsubscribeArtifactCode();
			unsubscribeOpenRequest();
			unsubscribeArtifactContents();
		};
	});

	onDestroy(() => {
		workspaceActiveFile.set(null);
		workspaceOpenFilePaths.set([]);
	});

	$: {
		const nextWorkspaceChatId = $chatId ?? '';
		if (shouldResetWorkspaceForChatChange($workspaceChatContextId, nextWorkspaceChatId)) {
			restoreWorkspaceState(nextWorkspaceChatId);
			workspaceTerminalConnectionId.set(null);
			rebuildWorkspaceContents();
		}
		workspaceChatContextId.set(nextWorkspaceChatId);
	}

	$: if (selectedContentId !== activeOpenedFileId) {
		activeOpenedFileId = selectedContentId;
		if (selectedContent?.type === 'workspace-file') touchOpenedFile(selectedContentId);
	}

	$: {
		(showFiles,
			codeInterpreterEnabled,
			$terminalServers,
			$selectedTerminalId,
			$workspaceTerminalConnectionId,
			$workspaceUtilityInstances);
		rebuildWorkspaceContents();
	}
</script>

<div
	class=" w-full h-full relative flex flex-col bg-white dark:bg-gray-850"
	id="artifacts-container"
>
	<div class="w-full h-full flex flex-col flex-1 relative">
		{#if hasWorkspaceTabs}
			<WorkspaceTabs
				tabs={workspaceTabs}
				bind:selectedIndex={selectedContentIdx}
				terminalId={workspaceTerminalId}
				filesAvailable={workspaceFilesAvailable}
				onSelect={(tab) => selectWorkspaceContent(tab.index)}
				onReorder={reorderWorkspaceTabs}
				onCloseTab={closeWorkspaceTab}
				onOpenFiles={openWorkspaceFiles}
				onOpenTerminal={() => openWorkspaceUtility('terminal')}
				onOpenBrowser={() => openWorkspaceUtility('browser')}
				onClose={closeWorkspace}
			/>
		{:else}
			<div
				class="flex h-11 shrink-0 items-center justify-end border-b border-gray-100 bg-white px-2 dark:border-gray-800 dark:bg-gray-850"
				data-testid="workspace-empty-header"
			>
				<button
					type="button"
					class="flex size-8 items-center justify-center rounded-md text-gray-500 transition hover:bg-gray-100 hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-400 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white dark:focus-visible:ring-gray-500"
					aria-label={$i18n.t('Close')}
					title={$i18n.t('Close')}
					on:mousedown|preventDefault|stopPropagation={() => {}}
					on:click|preventDefault|stopPropagation={closeWorkspace}
				>
					<XMark className="size-4" />
				</button>
			</div>
		{/if}

		{#if contents.length > 0 && !selectedIsCanvasNote && selectedHasArtifactActions}
			<div
				class="pointer-events-auto z-20 flex justify-between items-center border-b border-gray-100 p-2.5 font-primar text-gray-900 dark:border-gray-850 dark:text-white"
			>
				<div class="flex-1 flex items-center justify-between pr-1">
					{#if !hasWorkspaceTabs}
						<div class="flex items-center space-x-2">
							<div class="flex items-center gap-0.5 self-center min-w-fit" dir="ltr">
								<button
									aria-label={$i18n.t('Previous version')}
									class="self-center p-1 hover:bg-black/5 dark:hover:bg-white/5 dark:hover:text-white hover:text-black rounded-md transition disabled:cursor-not-allowed"
									on:click={() => navigateContent('prev')}
									disabled={contents.length <= 1}
								>
									<svg
										xmlns="http://www.w3.org/2000/svg"
										fill="none"
										viewBox="0 0 24 24"
										stroke="currentColor"
										stroke-width="2.5"
										class="size-3.5"
									>
										<path
											stroke-linecap="round"
											stroke-linejoin="round"
											d="M15.75 19.5 8.25 12l7.5-7.5"
										/>
									</svg>
								</button>

								<div class="text-xs self-center dark:text-gray-100 min-w-fit">
									{$i18n.t('Version {{selectedVersion}} of {{totalVersions}}', {
										selectedVersion: selectedContentIdx + 1,
										totalVersions: contents.length
									})}
								</div>

								<button
									aria-label={$i18n.t('Next version')}
									class="self-center p-1 hover:bg-black/5 dark:hover:bg-white/5 dark:hover:text-white hover:text-black rounded-md transition disabled:cursor-not-allowed"
									on:click={() => navigateContent('next')}
									disabled={contents.length <= 1}
								>
									<svg
										xmlns="http://www.w3.org/2000/svg"
										fill="none"
										viewBox="0 0 24 24"
										stroke="currentColor"
										stroke-width="2.5"
										class="size-3.5"
									>
										<path
											stroke-linecap="round"
											stroke-linejoin="round"
											d="m8.25 4.5 7.5 7.5-7.5 7.5"
										/>
									</svg>
								</button>
							</div>
						</div>
					{/if}

					<div class="flex items-center gap-1.5">
						<button
							class="copy-code-button bg-none border-none text-xs bg-gray-50 hover:bg-gray-100 dark:bg-gray-850 dark:hover:bg-gray-800 transition rounded-md px-1.5 py-0.5"
							on:click={() => {
								copyToClipboard(contents[selectedContentIdx].content);
								copied = true;

								setTimeout(() => {
									copied = false;
								}, 2000);
							}}>{copied ? $i18n.t('Copied') : $i18n.t('Copy')}</button
						>

						<Tooltip content={$i18n.t('Download')}>
							<button
								class=" bg-none border-none text-xs bg-gray-50 hover:bg-gray-100 dark:bg-gray-850 dark:hover:bg-gray-800 transition rounded-md p-0.5"
								on:click={downloadArtifact}
							>
								<Download className="size-3.5" />
							</button>
						</Tooltip>

						{#if contents[selectedContentIdx].type === 'iframe'}
							<Tooltip content={$i18n.t('Open in full screen')}>
								<button
									class=" bg-none border-none text-xs bg-gray-50 hover:bg-gray-100 dark:bg-gray-850 dark:hover:bg-gray-800 transition rounded-md p-0.5"
									on:click={showFullScreen}
								>
									<ArrowsPointingOut className="size-3.5" />
								</button>
							</Tooltip>
						{/if}
					</div>
				</div>

				{#if !hasWorkspaceTabs}
					<button
						class="self-center pointer-events-auto p-1 rounded-full bg-white dark:bg-gray-850"
						on:click={closeWorkspace}
					>
						<XMark className="size-3.5 text-gray-900 dark:text-white" />
					</button>
				{/if}
			</div>
		{/if}

		{#if overlay}
			<div class=" absolute top-0 left-0 right-0 bottom-0 z-10"></div>
		{/if}

		<div class="flex-1 min-h-0 w-full h-full">
			<div class=" h-full flex flex-col">
				{#if contents.length > 0}
					<div class="relative max-w-full w-full h-full">
						<WorkspaceDocumentPanels
							{contents}
							{selectedContentId}
							runtime={workspaceRuntime}
							chatId={$chatId}
						/>
						{#each contents as content, index (getWorkspaceContentId(content, index))}
							{#if content.type === 'workspace-browser'}
								<div
									id={`workspace-panel-${index}`}
									role="tabpanel"
									aria-labelledby={`workspace-tab-${index}`}
									hidden={selectedContentId !== getWorkspaceContentId(content, index)}
									class="absolute inset-0"
								>
									<WorkspaceBrowser
										{overlay}
										terminalId={content.terminalId ?? null}
										active={selectedContentId === getWorkspaceContentId(content, index)}
									/>
								</div>
							{/if}
						{/each}
						{#each contents as content, index (getWorkspaceContentId(content, index))}
							{#if content.type !== 'workspace-file' && content.type !== 'workspace-browser' && index !== selectedContentIdx}
								<div
									id={`workspace-panel-${index}`}
									role="tabpanel"
									aria-labelledby={`workspace-tab-${index}`}
									hidden
								></div>
							{/if}
						{/each}
						{#if !['workspace-file', 'workspace-browser'].includes(contents[selectedContentIdx].type)}
							<div
								id={workspacePanelId}
								role="tabpanel"
								aria-labelledby={`workspace-tab-${selectedContentIdx}`}
								class:pointer-events-none={contents[selectedContentIdx].type ===
									'workspace-terminal'}
								class="absolute inset-0"
							>
								{#if contents[selectedContentIdx].type === 'workspace-terminal'}
									<!-- The persistent terminal renderer is owned by ChatControls. -->
								{:else if contents[selectedContentIdx].type === 'iframe'}
									<iframe
										bind:this={iframeElement}
										title="Content"
										srcdoc={injectCsp(
											contents[selectedContentIdx].content,
											$config?.ui?.iframe_csp ?? ''
										)}
										class="w-full border-0 h-full rounded-none"
										sandbox="allow-scripts allow-downloads{($settings?.iframeSandboxAllowForms ??
										false)
											? ' allow-forms'
											: ''}{($settings?.iframeSandboxAllowSameOrigin ?? false)
											? ' allow-same-origin'
											: ''}"
										on:load={iframeLoadHandler}
									></iframe>
								{:else if contents[selectedContentIdx].type === 'svg'}
									<SvgPanZoom
										className=" w-full h-full max-h-full overflow-hidden"
										svg={contents[selectedContentIdx].content}
									/>
								{:else if contents[selectedContentIdx].type === 'canvas-note'}
									<NoteCanvas
										chatId={$chatId}
										canvasId={contents[selectedContentIdx].canvasId ?? ''}
										noteId={contents[selectedContentIdx].noteId ?? ''}
										title={contents[selectedContentIdx].title ?? ''}
										content={contents[selectedContentIdx].content}
										titleEdited={contents[selectedContentIdx].titleEdited ?? false}
										canUndoAiUpdate={contents[selectedContentIdx].canUndoAiUpdate ?? false}
										showClose={!hasWorkspaceTabs}
										on:close={closeWorkspace}
									/>
								{:else if contents[selectedContentIdx].type === 'web-preview'}
									{#key contents[selectedContentIdx].previewId}
										<WebPreviewRenderer
											artifact={contents[selectedContentIdx] as any}
											chatId={$chatId ?? ''}
											codeInterpreterEnabled={showFiles && codeInterpreterEnabled}
											iframeCsp={$config?.ui?.iframe_csp ?? ''}
											sandboxAllowForms={$settings?.iframeSandboxAllowForms ?? false}
											sandboxAllowSameOrigin={$settings?.iframeSandboxAllowSameOrigin ?? false}
										/>
									{/key}
								{:else if contents[selectedContentIdx].type === 'workspace-files'}
									{#if workspaceRuntime.kind === 'terminal'}
										<FileNav
											{onAttach}
											{overlay}
											chatId={$chatId}
											initialFilePath={contents[selectedContentIdx].path ?? null}
											onOpenFile={openWorkspaceFile}
										/>
									{:else if workspaceRuntime.kind === 'pyodide'}
										<PyodideFileNav {overlay} onOpenFile={openWorkspaceFile} />
									{/if}
								{/if}
							</div>
						{/if}
					</div>
				{:else}
					<WorkspaceLauncher
						terminalId={workspaceTerminalId}
						filesAvailable={workspaceFilesAvailable}
						onOpenFiles={openWorkspaceFiles}
						onOpenTerminal={() => openWorkspaceUtility('terminal')}
						onOpenBrowser={() => openWorkspaceUtility('browser')}
					/>
				{/if}
			</div>
		</div>
	</div>
</div>
