<script lang="ts">
	import { toast } from 'svelte-sonner';
	import { onMount, getContext, createEventDispatcher } from 'svelte';
	const i18n = getContext('i18n');
	const dispatch = createEventDispatcher();

	import {
		artifactCode,
		chatId,
		config,
		settings,
		showArtifacts,
		showControls,
		artifactContents
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
	import WorkspaceTabs from './Artifacts/WorkspaceTabs.svelte';
	import { getCanvasNoteArtifactsFromHistory } from './Artifacts/canvas';
	import { selectTransientCanvasDocument } from '$lib/apis/chats';
	import {
		buildWorkspaceTabs,
		getWorkspaceContentId,
		getVisibleWorkspaceContents,
		shouldShowWorkspaceTabs,
		type WorkspaceContent,
		type WorkspaceTab
	} from './Artifacts/workspace';

	export let overlay = false;
	export let history = null;

	let sourceContents: WorkspaceContent[] = [];
	let contents: WorkspaceContent[] = [];
	let selectedContentIdx = 0;
	let closedWorkspaceContentIds = new Set<string>();
	let workspaceChatId = '';
	$: selectedContent = contents[selectedContentIdx];
	$: selectedIsCanvasNote = selectedContent?.type === 'canvas-note';
	$: workspaceTabs = buildWorkspaceTabs(contents);
	$: hasWorkspaceTabs = shouldShowWorkspaceTabs(contents);

	let copied = false;
	let iframeElement: HTMLIFrameElement;

	function navigateContent(direction: 'prev' | 'next') {
		selectedContentIdx =
			direction === 'prev'
				? Math.max(selectedContentIdx - 1, 0)
				: Math.min(selectedContentIdx + 1, contents.length - 1);
	}

	async function selectWorkspaceContent(index: number) {
		const content = contents[index];
		if (!content) return;

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
				toast.error($i18n.t('Document could not be opened'));
				return;
			}
		}

		selectedContentIdx = index;
		artifactCode.set(getWorkspaceContentId(content, index));
	}

	function syncVisibleWorkspaceContents() {
		const newContents = getVisibleWorkspaceContents(sourceContents, closedWorkspaceContentIds);

		if (newContents.length === 0) {
			contents = [];
			selectedContentIdx = 0;
			return;
		}

		const selectedIdx = newContents.findIndex(
			(content, index) =>
				getWorkspaceContentId(content, index) === $artifactCode ||
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

		return getCanvasNoteArtifactsFromHistory(history) as WorkspaceContent[];
	}

	function closeWorkspaceTab(tab: WorkspaceTab) {
		const selectedId = selectedContent
			? getWorkspaceContentId(selectedContent, selectedContentIdx)
			: '';
		closedWorkspaceContentIds = new Set(closedWorkspaceContentIds).add(tab.id);
		syncVisibleWorkspaceContents();

		if (contents.length === 0) {
			closeWorkspace();
			return;
		}

		const selectedIdx = contents.findIndex(
			(content, index) => getWorkspaceContentId(content, index) === selectedId
		);
		selectedContentIdx =
			selectedIdx !== -1 ? selectedIdx : Math.min(tab.index, contents.length - 1);
		const nextContent = contents[selectedContentIdx];
		artifactCode.set(getWorkspaceContentId(nextContent, selectedContentIdx));
	}

	function closeWorkspace() {
		dispatch('close');
		showArtifacts.set(false);
		showControls.set(false);
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
		const unsubscribeArtifactCode = artifactCode.subscribe((value) => {
			if (closedWorkspaceContentIds.has(value)) {
				closedWorkspaceContentIds = new Set(closedWorkspaceContentIds);
				closedWorkspaceContentIds.delete(value);
				syncVisibleWorkspaceContents();
			}

			if (contents.length > 0) {
				const codeIdx = contents.findIndex(
					(content, index) =>
						getWorkspaceContentId(content, index) === value ||
						content.canvasId === value ||
						content.noteId === value ||
						content.content.includes(value)
				);
				selectedContentIdx = codeIdx !== -1 ? codeIdx : 0;
			}
		});

		const unsubscribeArtifactContents = artifactContents.subscribe((value) => {
			sourceContents = resolveWorkspaceContents(value);
			syncVisibleWorkspaceContents();
		});

		return () => {
			unsubscribeArtifactCode();
			unsubscribeArtifactContents();
		};
	});

	$: if ($chatId !== workspaceChatId) {
		workspaceChatId = $chatId;
		closedWorkspaceContentIds = new Set();
		syncVisibleWorkspaceContents();
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
				onSelect={(tab) => selectWorkspaceContent(tab.index)}
				onCloseTab={closeWorkspaceTab}
				onClose={closeWorkspace}
			/>
		{/if}

		{#if contents.length > 0 && !selectedIsCanvasNote}
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

		<div class="flex-1 min-h-0 w-full h-full" id="workspace-active-content" role="tabpanel">
			<div class=" h-full flex flex-col">
				{#if contents.length > 0}
					<div class="max-w-full w-full h-full">
						{#if contents[selectedContentIdx].type === 'iframe'}
							<iframe
								bind:this={iframeElement}
								title="Content"
								srcdoc={injectCsp(
									contents[selectedContentIdx].content,
									$config?.ui?.iframe_csp ?? ''
								)}
								class="w-full border-0 h-full rounded-none"
								sandbox="allow-scripts allow-downloads{($settings?.iframeSandboxAllowForms ?? false)
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
						{/if}
					</div>
				{:else}
					<div class="m-auto font-normal text-xs text-gray-900 dark:text-white">
						{$i18n.t('No HTML, CSS, or JavaScript content found.')}
					</div>
				{/if}
			</div>
		</div>
	</div>
</div>
