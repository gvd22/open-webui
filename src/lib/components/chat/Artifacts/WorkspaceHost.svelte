<script lang="ts">
	import { toast } from 'svelte-sonner';
	import { onMount, onDestroy, getContext, createEventDispatcher } from 'svelte';
	import type { Writable } from 'svelte/store';
	import type { i18n as i18nType } from 'i18next';
	const i18n: Writable<i18nType> = getContext('i18n');
	const dispatch = createEventDispatcher();

	import {
		artifactCode,
		chatId,
		config,
		settings,
		showArtifacts,
		showControls,
		artifactContents,
		workspaceChatContextId,
		workspaceOpenRequestId,
		workspaceActiveFile,
		workspaceOpenFilePaths,
		showFileNavPath
	} from '$lib/stores';
	import { copyToClipboard } from '$lib/utils';
	import { injectCsp } from '$lib/utils/csp';

	import XMark from '../../icons/XMark.svelte';
	import ArrowsPointingOut from '../../icons/ArrowsPointingOut.svelte';
	import Tooltip from '../../common/Tooltip.svelte';
	import SvgPanZoom from '../../common/SVGPanZoom.svelte';
	import Download from '../../icons/Download.svelte';
	import NoteCanvas from './NoteCanvas.svelte';
	import PyodideFileNav from '../PyodideFileNav.svelte';
	import WorkspaceTabs from './WorkspaceTabs.svelte';
	import WebPreviewRenderer from './WebPreviewRenderer.svelte';
	import WorkspaceDocumentPanels from './WorkspaceDocumentPanels.svelte';
	import { getCanvasNoteArtifactsFromHistory } from './canvas';
	import { getWebPreviewsFromHistory } from './webPreview';
	import { readWorkspaceState, writeWorkspaceState } from './workspaceSession';
	import { selectWorkspaceArtifact } from '../Messages/workspaceArtifactOpen';
	import {
		buildWorkspaceTabs,
		buildWorkspaceFileContent,
		buildWorkspaceSourceContents,
		upsertWorkspaceFileContent,
		limitWorkspaceFileContents,
		getWorkspaceDocumentFormatForViewer,
		isWorkspaceOpenRequestForChat,
		getWorkspaceContentId,
		getVisibleWorkspaceContents,
		moveWorkspaceContent,
		orderWorkspaceContents,
		shouldShowWorkspaceTabs,
		shouldResetWorkspaceForChatChange,
		type WorkspaceContent,
		type WorkspaceTab,
		WORKSPACE_FILES_ID
	} from './workspace';

	export let overlay = false;
	export let history: Record<string, any> | null = null;
	export let showFiles = false;

	let artifactSourceContents: WorkspaceContent[] = [];
	let openedFileContents: WorkspaceContent[] = [];
	let filesOpened = false;
	let sourceContents: WorkspaceContent[] = [];
	let contents: WorkspaceContent[] = [];
	let workspaceContentOrder: string[] = [];
	let selectedContentIdx = 0;
	let closedWorkspaceContentIds = new Set<string>();
	let activeFileContextKey = '';
	let openedFileRecency: string[] = [];
	let activeOpenedFileId = '';
	let queuedFileFocusId = '';
	let fileFocusQueued = false;
	let workspacePersistenceWarningShown = false;
	let workspaceStateRestored = false;
	let workspaceFocusQueue = Promise.resolve();

	const persistWorkspaceState = (id = $chatId) => {
		if (!id) return;
		const saved = writeWorkspaceState(id, {
			order: workspaceContentOrder,
			closed: [...closedWorkspaceContentIds].filter((item) => item !== WORKSPACE_FILES_ID),
			filesOpened: showFiles || filesOpened,
			openedFiles: openedFileContents.flatMap((content) =>
				content.path
					? [{ path: content.path, ...(content.fileId ? { fileId: content.fileId } : {}) }]
					: []
			)
		});
		if (!saved && !workspacePersistenceWarningShown) {
			workspacePersistenceWarningShown = true;
			toast.error($i18n.t('Workspace layout could not be saved'));
		}
	};

	const restoreWorkspaceState = (id: string) => {
		const state = readWorkspaceState(id);
		closedWorkspaceContentIds = new Set(state?.closed ?? []);
		closedWorkspaceContentIds.delete(WORKSPACE_FILES_ID);
		workspaceContentOrder = state?.order ?? [];
		filesOpened = showFiles || (state?.filesOpened ?? false);
		openedFileContents = (state?.openedFiles ?? []).map((file) =>
			buildWorkspaceFileContent(file.path, null, file.fileId)
		);
		openedFileRecency = openedFileContents.map((content, index) =>
			getWorkspaceContentId(content, index)
		);
	};
	$: selectedContent = contents[selectedContentIdx];
	$: selectedContentId = selectedContent
		? getWorkspaceContentId(selectedContent, selectedContentIdx)
		: '';
	$: workspacePanelId = `workspace-panel-${selectedContentIdx}`;
	$: selectedIsCanvasNote = selectedContent?.type === 'canvas-note';
	$: selectedHasArtifactActions = ['iframe', 'svg'].includes(selectedContent?.type);
	$: hasWorkspaceTabs = shouldShowWorkspaceTabs(contents);

	let copied = false;
	let iframeElement: HTMLIFrameElement;
	const MAX_OPEN_DOCUMENTS = 4;
	$: if (
		workspaceStateRestored &&
		showFiles &&
		(!filesOpened || closedWorkspaceContentIds.has(WORKSPACE_FILES_ID))
	) {
		openWorkspaceFiles();
	}
	$: documentViewerEnabled = $config?.features?.enable_document_viewer === true;
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

	function queueWorkspaceFocus(content: WorkspaceContent, targetChatId: string) {
		workspaceFocusQueue = workspaceFocusQueue
			.catch(() => {})
			.then(async () => {
				await selectWorkspaceArtifact(content, targetChatId);
			})
			.catch((error) => {
				if ($chatId !== targetChatId) return;
				if (content.type === 'web-preview') {
					console.error('Web Preview focus could not be saved', error);
					toast.error($i18n.t('Web Preview focus could not be saved'));
				} else {
					console.error('Canvas focus could not be saved', error);
					toast.error($i18n.t('Canvas focus could not be saved'));
				}
			});
	}

	function selectWorkspaceContent(index: number) {
		const content = contents[index];
		const targetChatId = $chatId;
		if (!content) return;

		selectedContentIdx = index;
		artifactCode.set(getWorkspaceContentId(content, index));

		if (targetChatId) queueWorkspaceFocus(content, targetChatId);
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

	function rebuildWorkspaceContents(
		filesVisible = showFiles,
		viewerEnabled = documentViewerEnabled
	) {
		const nextSourceContents = buildWorkspaceSourceContents(
			filesVisible,
			filesOpened,
			viewerEnabled,
			artifactSourceContents,
			openedFileContents
		);
		sourceContents = orderWorkspaceContents(nextSourceContents, workspaceContentOrder);
		const sourceIds = sourceContents.map((content, index) => getWorkspaceContentId(content, index));
		// History arrives after the restored utilities during a chat reload. Keep IDs that are
		// temporarily absent so that their saved positions still apply once artifacts hydrate.
		workspaceContentOrder = [...new Set([...workspaceContentOrder, ...sourceIds])];
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

	function openWorkspaceFile(
		path: string,
		options: { page?: number | null; fileId?: string | null } = {}
	): boolean {
		if (
			(!showFiles && !options.fileId) ||
			!getWorkspaceDocumentFormatForViewer(path, documentViewerEnabled)
		) {
			return false;
		}
		const id = `workspace:file:${path}`;
		const nextContents = upsertWorkspaceFileContent(
			openedFileContents,
			path,
			options.page,
			options.fileId
		);
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

	function openDurableFileRequest(
		request: {
			path: string;
			page?: number | null;
			fileId?: string | null;
			chatId?: string | null;
		} | null
	) {
		if (!isWorkspaceOpenRequestForChat(request?.chatId, $chatId)) {
			showFileNavPath.set(null);
			return;
		}
		if (!request?.fileId || $config === undefined) return;
		showFileNavPath.set(null);
		if (!openWorkspaceFile(request.path, request)) {
			toast.error($i18n.t('This document cannot be opened in the workspace.'));
		}
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
		if (tab.id === WORKSPACE_FILES_ID) return;
		const selectedId = selectedContent
			? getWorkspaceContentId(selectedContent, selectedContentIdx)
			: '';
		closedWorkspaceContentIds = new Set(closedWorkspaceContentIds).add(tab.id);
		openedFileRecency = openedFileRecency.filter((id) => id !== tab.id);
		syncVisibleWorkspaceContents();

		if (contents.length === 0) {
			artifactCode.set('');
			persistWorkspaceState();
			return;
		}

		const selectedIdx = contents.findIndex(
			(content, index) => getWorkspaceContentId(content, index) === selectedId
		);
		selectedContentIdx =
			selectedIdx !== -1 ? selectedIdx : Math.min(tab.index, contents.length - 1);
		selectWorkspaceContent(selectedContentIdx);
		persistWorkspaceState();
	}

	function closeWorkspace() {
		persistWorkspaceState();
		dispatch('close');
		showControls.set(false);
		showArtifacts.set(false);
	}

	const iframeLoadHandler = () => {
		const frameWindow = iframeElement.contentWindow;
		if (!frameWindow) return;

		frameWindow.addEventListener(
			'click',
			function (e) {
				const target = e.target instanceof Element ? e.target.closest('a') : null;
				if (target && target.href) {
					e.preventDefault();
					const url = new URL(target.href, iframeElement.baseURI);
					if (url.origin === window.location.origin) {
						frameWindow.history.pushState(null, '', url.pathname + url.search + url.hash);
					} else {
						console.info('External navigation blocked:', url.href);
					}
				}
			},
			true
		);

		// Cancel drag when hovering over iframe
		frameWindow.addEventListener('mouseenter', function (e) {
			e.preventDefault();
			frameWindow.addEventListener('dragstart', (event) => {
				event.preventDefault();
			});
		});
	};

	const showFullScreen = () => {
		const frame = iframeElement as HTMLIFrameElement & {
			webkitRequestFullscreen?: () => Promise<void> | void;
			msRequestFullscreen?: () => Promise<void> | void;
		};
		if (frame.requestFullscreen) {
			void frame.requestFullscreen();
		} else if (frame.webkitRequestFullscreen) {
			void frame.webkitRequestFullscreen();
		} else if (frame.msRequestFullscreen) {
			void frame.msRequestFullscreen();
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
		workspaceStateRestored = true;
		rebuildWorkspaceContents();

		const unsubscribeArtifactCode = artifactCode.subscribe((value) => {
			if (value === WORKSPACE_FILES_ID) {
				ensureWorkspaceFilesOpen();
				selectWorkspaceFiles();
				return;
			}
			if (value && contents.length > 0) {
				const codeIdx = contents.findIndex(
					(content, index) =>
						getWorkspaceContentId(content, index) === value ||
						content.previewId === value ||
						content.canvasId === value ||
						content.noteId === value ||
						content.content === value
				);
				if (codeIdx !== -1) selectedContentIdx = codeIdx;
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
			rebuildWorkspaceContents();
		}
		workspaceChatContextId.set(nextWorkspaceChatId);
	}

	$: if (selectedContentId !== activeOpenedFileId) {
		activeOpenedFileId = selectedContentId;
		if (selectedContent?.type === 'workspace-file') touchOpenedFile(selectedContentId);
	}

	$: rebuildWorkspaceContents(showFiles, documentViewerEnabled);

	$: if (workspaceStateRestored && $config !== undefined && typeof $showFileNavPath === 'object') {
		openDurableFileRequest($showFileNavPath);
	}
</script>

<div
	class=" w-full h-full relative flex flex-col bg-white dark:bg-gray-850"
	id="artifacts-container"
>
	<div class="w-full h-full flex flex-col flex-1 relative">
		{#if hasWorkspaceTabs}
			<WorkspaceTabs
				tabs={buildWorkspaceTabs(contents)}
				bind:selectedIndex={selectedContentIdx}
				onSelect={(tab) => selectWorkspaceContent(tab.index)}
				onReorder={reorderWorkspaceTabs}
				onCloseTab={closeWorkspaceTab}
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
			</div>
		{/if}

		{#if overlay}
			<div class=" absolute top-0 left-0 right-0 bottom-0 z-10"></div>
		{/if}

		<div class="flex-1 min-h-0 w-full h-full">
			<div class=" h-full flex flex-col">
				{#if contents.length > 0}
					<div class="relative max-w-full w-full h-full">
						<WorkspaceDocumentPanels {contents} {selectedContentId} />
						{#each contents as content, index (getWorkspaceContentId(content, index))}
							{#if content.type === 'workspace-files'}
								<div
									id={`workspace-panel-${index}`}
									role="tabpanel"
									aria-labelledby={`workspace-tab-${index}`}
									hidden={index !== selectedContentIdx}
									class="absolute inset-0"
								>
									{#if showFiles}
										<PyodideFileNav {overlay} onOpenFile={openWorkspaceFile} />
									{/if}
								</div>
							{:else if content.type !== 'workspace-file' && index !== selectedContentIdx}
								<div
									id={`workspace-panel-${index}`}
									role="tabpanel"
									aria-labelledby={`workspace-tab-${index}`}
									hidden
								></div>
							{/if}
						{/each}
						{#if !['workspace-file', 'workspace-files'].includes(contents[selectedContentIdx].type)}
							<div
								id={workspacePanelId}
								role="tabpanel"
								aria-labelledby={`workspace-tab-${selectedContentIdx}`}
								class="absolute inset-0"
							>
								{#if contents[selectedContentIdx].type === 'iframe'}
									<iframe
										bind:this={iframeElement}
										title="Content"
										srcdoc={injectCsp(
											contents[selectedContentIdx].content,
											$config?.ui?.iframe_csp ?? ''
										)}
										class="w-full border-0 h-full rounded-none"
										sandbox="{($settings?.iframeSandboxAllowScripts ?? true)
											? 'allow-scripts'
											: ''}{($settings?.iframeSandboxAllowDownloads ?? true)
											? ' allow-downloads'
											: ''}{($settings?.iframeSandboxAllowForms ?? false)
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
									{#key `${$chatId}:${contents[selectedContentIdx].canvasId ?? ''}`}
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
									{/key}
								{:else if contents[selectedContentIdx].type === 'web-preview'}
									{#key `${$chatId}:${contents[selectedContentIdx].previewId ?? ''}`}
										<WebPreviewRenderer
											artifact={contents[selectedContentIdx] as any}
											chatId={$chatId ?? ''}
											pyodideFilesAvailable={showFiles}
											iframeCsp={$config?.ui?.iframe_csp ?? ''}
											sandboxAllowScripts={$settings?.iframeSandboxAllowScripts ?? true}
											sandboxAllowDownloads={$settings?.iframeSandboxAllowDownloads ?? true}
											sandboxAllowForms={$settings?.iframeSandboxAllowForms ?? false}
											sandboxAllowSameOrigin={$settings?.iframeSandboxAllowSameOrigin ?? false}
										/>
									{/key}
								{/if}
							</div>
						{/if}
					</div>
				{/if}
			</div>
		</div>
	</div>
</div>
