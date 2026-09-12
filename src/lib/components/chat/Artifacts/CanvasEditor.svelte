<script lang="ts">
	import { createEventDispatcher, getContext, onDestroy, onMount } from 'svelte';
	import { get } from 'svelte/store';
	import type { Writable } from 'svelte/store';
	import type { i18n as i18nType } from 'i18next';
	import { toast } from 'svelte-sonner';

	import RichTextInput from '$lib/components/common/RichTextInput.svelte';
	import ArtifactConflict from './ArtifactConflict.svelte';
	import CanvasSelectionEditor from './CanvasSelectionEditor.svelte';
	import CanvasDocumentChanges from './CanvasDocumentChanges.svelte';
	import { addCanvasSelectionToChat } from './canvasSelectionRequest';
	import {
		draftKey,
		readConflictDraft,
		keepConflictDraft,
		clearConflictDraft
	} from './artifactEditing';
	import Tooltip from '$lib/components/common/Tooltip.svelte';
	import XMark from '$lib/components/icons/XMark.svelte';
	import DocumentArrowUp from '$lib/components/icons/DocumentArrowUp.svelte';
	import DocumentCheck from '$lib/components/icons/DocumentCheck.svelte';
	import { artifactContents, config, socket, user } from '$lib/stores';
	import {
		promoteTransientCanvasDocument,
		selectTransientCanvasDocument,
		updateTransientCanvasDocument
	} from '$lib/apis/chats';
	import { canUseNotes, generateCanvasTitle } from './canvas';
	import {
		createSerializedSaveQueue,
		registerWorkspaceSaveBarrier,
		resetWorkspaceSaveVersion,
		runWorkspaceOptimisticSave
	} from './serializedSaveQueue';

	const i18n: Writable<i18nType> = getContext('i18n');
	const dispatch = createEventDispatcher();

	export let canvasId = '';
	export let chatId = '';
	export let title = '';
	export let content = '';
	export let titleEdited = false;
	export let showClose = true;
	export let noteId = '';

	let editor: any = null;
	let value = content;
	let html = '';
	let md = content;
	let json: any = null;
	let titleValue = generateCanvasTitle(content, title);
	let lastTitleProp = title;
	let saving = false;
	let linkedNoteId = noteId;
	$: if (noteId && noteId !== linkedNoteId) linkedNoteId = noteId;
	$: notesAvailable = canUseNotes(
		Boolean($config?.features?.enable_notes),
		$user?.role,
		$user?.permissions?.features?.notes
	);
	let lastContentProp = content;
	let transientSaveError = false;
	let lastLocalContent = '';
	let isApplyingExternalContent = false;
	let richTextInput: any = null;
	let unregisterSaveBarrier = () => {};
	let conflict: { title: string; content: string; titleEdited: boolean } | null = null;
	let serverVersion: any = null;
	let resolving = false;
	let disposed = false;
	let localPending = false;
	let selection = '';
	let selectionEditor: any = null;
	const recoveryKey = () => draftKey($user?.id ?? '', chatId, 'canvas', canvasId);
	const rememberDraft = () => {
		conflict = { title: titleValue, content: md, titleEdited };
		if (!keepConflictDraft(recoveryKey(), conflict))
			toast.warning($i18n.t('Draft kept in memory only. Keep this browser tab open.'));
	};
	const resolveConflict = async (recover: boolean) => {
		if (!conflict || resolving) return;
		const targetChat = chatId,
			targetId = canvasId;
		resolving = true;
		try {
			const current = await selectTransientCanvasDocument(localStorage.token, targetChat, targetId);
			if (disposed || chatId !== targetChat || canvasId !== targetId) return;
			serverVersion = current;
			const draft = conflict;
			conflict = null;
			transientSaveError = false;
			resetWorkspaceSaveVersion(
				{ chatId, kind: 'canvas', id: canvasId },
				{ updatedAt: current.updated_at, contentHash: current.contentHash }
			);
			updateCanvasState({ updatedAt: current.updated_at, contentHash: current.contentHash });
			if (recover) {
				queueTransientSave(draft.title, draft.content, draft.titleEdited);
				updateCanvasState({
					content: draft.content,
					title: draft.title,
					titleEdited: draft.titleEdited,
					canUndoAiUpdate: false
				});
				await transientSaveQueue.flush();
			} else {
				clearConflictDraft(recoveryKey());
				localPending = false;
				applyExternalContent(current.content);
				titleValue = current.title;
				titleEdited = Boolean(current.title_edited);
				updateCanvasState({
					content: current.content,
					title: current.title,
					titleEdited,
					canUndoAiUpdate: Boolean(current.last_ai_update)
				});
			}
		} catch (error) {
			toast.error($i18n.t('Draft recovery failed. Your draft is still kept.'));
		} finally {
			resolving = false;
		}
	};
	const captureSelection = () => {
		if (!editor) return;
		const { from, to } = editor.state.selection;
		selection = from === to ? '' : editor.state.doc.textBetween(from, to, '\n\n');
	};
	$: if (editor !== selectionEditor) {
		selectionEditor?.off('selectionUpdate', captureSelection);
		selectionEditor = editor;
		selectionEditor?.on('selectionUpdate', captureSelection);
	}
	const askAboutSelection = async (instruction: string) => {
		const selectedSource = md;
		try {
			return await addCanvasSelectionToChat({
				chatId,
				canvasId,
				content: selectedSource,
				selection,
				title: generatedTitle,
				instruction,
				save: async () => {
					await transientSaveQueue.flush();
					return !transientSaveError && !conflict;
				},
				isCurrent: () => !disposed && md === selectedSource
			});
		} catch (error: any) {
			toast.error($i18n.t(error?.message ?? 'Could not verify this selection. Please try again.'));
		}
	};

	$: generatedTitle = titleValue || generateCanvasTitle(md || value || content, title);
	$: if (!conflict && !localPending && title !== lastTitleProp && title !== titleValue) {
		lastTitleProp = title;
		titleValue = generateCanvasTitle(md || value || content, title);
	}
	const applyExternalContent = (nextContent: string) => {
		isApplyingExternalContent = true;
		value = nextContent;
		md = nextContent;
		html = '';
		json = null;
		lastLocalContent = nextContent;
		queueMicrotask(() => {
			richTextInput?.setValue(nextContent);
			isApplyingExternalContent = false;
		});
	};

	$: if (!conflict && !localPending && content !== lastContentProp) {
		lastContentProp = content;
		if (content !== lastLocalContent) {
			applyExternalContent(content);
		}
	}

	const updateCanvasState = (updates: Record<string, unknown>) => {
		(artifactContents as any).update((contents: any[]) => {
			let changed = false;
			const nextContents = ((contents ?? []) as any[]).map((item) => {
				if (item.canvasId !== canvasId) return item;
				if (!Object.entries(updates).some(([key, nextValue]) => item[key] !== nextValue)) {
					return item;
				}
				changed = true;
				return { ...item, ...updates };
			});
			return changed ? nextContents : contents;
		});
	};

	const saveTransientCanvas = async (nextSave: {
		targetChatId: string;
		targetCanvasId: string;
		title: string;
		content: string;
		titleEdited: boolean;
		expectedUpdatedAt?: number;
		expectedContentHash?: string;
	}) => {
		if (!nextSave.targetChatId || !nextSave.targetCanvasId || conflict) {
			return;
		}
		const savedDraftKey = draftKey(
			$user?.id ?? '',
			nextSave.targetChatId,
			'canvas',
			nextSave.targetCanvasId
		);

		try {
			const document = await runWorkspaceOptimisticSave(
				{
					chatId: nextSave.targetChatId,
					kind: 'canvas',
					id: nextSave.targetCanvasId
				},
				{ updatedAt: nextSave.expectedUpdatedAt, contentHash: nextSave.expectedContentHash },
				async (version) => {
					const saved = await updateTransientCanvasDocument(
						localStorage.token,
						nextSave.targetChatId,
						nextSave.targetCanvasId,
						{
							title: nextSave.title || generateCanvasTitle(nextSave.content, title),
							content: nextSave.content,
							title_edited: nextSave.titleEdited,
							expected_updated_at: version.updatedAt ?? null,
							expected_content_hash: version.contentHash ?? null
						}
					);
					return { ...saved, updatedAt: saved.updated_at };
				}
			);
			if (nextSave.content === md && nextSave.title === titleValue)
				clearConflictDraft(savedDraftKey);
			if (disposed || chatId !== nextSave.targetChatId || canvasId !== nextSave.targetCanvasId)
				return;
			updateCanvasState({
				updatedAt: document.updated_at,
				contentHash: document.contentHash,
				titleEdited: Boolean(document.title_edited)
			});
			transientSaveError = false;
			if (nextSave.content === md && nextSave.title === titleValue) {
				localPending = false;
				clearConflictDraft(recoveryKey());
			}
		} catch (error: any) {
			if (error?.status === 409 && disposed)
				keepConflictDraft(savedDraftKey, {
					title: nextSave.title,
					content: nextSave.content,
					titleEdited: nextSave.titleEdited
				});
			if (disposed || chatId !== nextSave.targetChatId || canvasId !== nextSave.targetCanvasId)
				return;
			transientSaveError = true;
			if (error?.status === 409) {
				rememberDraft();
				try {
					const document = await selectTransientCanvasDocument(
						localStorage.token,
						chatId,
						canvasId
					);
					if (!disposed && chatId === nextSave.targetChatId && canvasId === nextSave.targetCanvasId)
						serverVersion = document;
				} catch (refreshError) {
					console.error('Unable to reload conflicted Canvas', refreshError);
					toast.error($i18n.t('Canvas changed elsewhere and could not be reloaded.'));
					return;
				}
				return;
			}
			console.error('Unable to save Canvas edit', error);
		}
	};
	const transientSaveQueue = createSerializedSaveQueue(saveTransientCanvas);

	const queueTransientSave = (nextTitle: string, nextContent: string, titleEdited: boolean) => {
		if (!chatId || !canvasId) {
			return;
		}
		localPending = true;
		if (conflict) return;
		const current = ((get(artifactContents) ?? []) as any[]).find(
			(item) => item?.canvasId === canvasId
		);
		transientSaveQueue.enqueue({
			targetChatId: chatId,
			targetCanvasId: canvasId,
			title: nextTitle,
			content: nextContent,
			titleEdited,
			expectedUpdatedAt: current?.updatedAt,
			expectedContentHash: current?.contentHash
		});
	};

	onMount(() => {
		const draft = readConflictDraft<{ title: string; content: string; titleEdited: boolean }>(
			recoveryKey()
		);
		if (draft && typeof draft.content === 'string' && typeof draft.title === 'string') {
			serverVersion = { content, title };
			conflict = draft;
			transientSaveError = true;
			applyExternalContent(draft.content);
			titleValue = draft.title;
			titleEdited = draft.titleEdited;
		}
		unregisterSaveBarrier = registerWorkspaceSaveBarrier(
			{ chatId, kind: 'canvas', id: canvasId },
			async () => {
				await transientSaveQueue.flush();
				return !transientSaveError;
			}
		);
	});

	onDestroy(() => {
		disposed = true;
		selectionEditor?.off('selectionUpdate', captureSelection);
		void transientSaveQueue.flush().finally(unregisterSaveBarrier);
	});

	const addToNotes = async () => {
		if (saving || !notesAvailable) {
			return;
		}

		saving = true;
		try {
			await transientSaveQueue.flush();
			if (transientSaveError) return;
			const current = ((get(artifactContents) ?? []) as any[]).find(
				(item) => item?.canvasId === canvasId
			);
			const promotion = {
				title: titleValue || generatedTitle,
				content: md || value || content,
				html,
				json,
				expected_updated_at: current?.updatedAt ?? null,
				expected_content_hash: current?.contentHash ?? null
			};
			let note;
			try {
				note = await promoteTransientCanvasDocument(
					localStorage.token,
					chatId,
					canvasId,
					promotion
				);
			} catch (error: any) {
				if (error?.status !== 409) throw error;

				const latest = await selectTransientCanvasDocument(localStorage.token, chatId, canvasId);
				if (latest.title !== promotion.title || latest.content !== promotion.content) {
					applyExternalContent(latest.content ?? '');
					titleValue = latest.title ?? titleValue;
					updateCanvasState({
						title: titleValue,
						content: latest.content ?? '',
						updatedAt: latest.updated_at,
						contentHash: latest.contentHash
					});
					toast.warning($i18n.t('Canvas changed elsewhere. The latest version was loaded.'));
					return;
				}

				note = await promoteTransientCanvasDocument(localStorage.token, chatId, canvasId, {
					...promotion,
					expected_updated_at: latest.updated_at,
					expected_content_hash: latest.contentHash
				});
			}
			linkedNoteId = note?.id ?? '';

			if (linkedNoteId) {
				updateCanvasState({ noteId: linkedNoteId, title: titleValue || generatedTitle });
				toast.success($i18n.t('Added to notes'), { position: 'bottom-right' });
			}
		} catch (error: any) {
			toast.error(error?.detail?.message ?? error?.detail ?? error?.message ?? `${error}`);
		} finally {
			saving = false;
		}
	};
</script>

<div
	class="relative flex h-full min-h-0 flex-col bg-white text-gray-900 dark:bg-gray-950 dark:text-gray-100"
>
	<div
		class="absolute end-3 top-2 z-20 rounded-lg bg-white/90 p-0.5 shadow-sm dark:bg-gray-950/90"
		data-testid="canvas-actions"
	>
		<div class="flex shrink-0 items-center gap-1">
			<CanvasDocumentChanges
				{editor}
				{chatId}
				{canvasId}
				disabled={!!conflict || resolving || localPending}
			/>
			{#if notesAvailable}
				<Tooltip content={$i18n.t(linkedNoteId ? 'In Notizen' : 'Zu Notizen hinzufügen')}>
					<button
						type="button"
						class="flex size-8 items-center justify-center rounded-md text-gray-500 transition hover:bg-gray-100 hover:text-gray-900 disabled:opacity-50 dark:text-gray-400 dark:hover:bg-gray-900 dark:hover:text-white"
						aria-label={$i18n.t(linkedNoteId ? 'In Notizen' : 'Zu Notizen hinzufügen')}
						aria-busy={saving}
						disabled={saving || !!linkedNoteId}
						on:mousedown|preventDefault|stopPropagation={addToNotes}
						on:click={addToNotes}
					>
						{#if linkedNoteId}<DocumentCheck className="size-4" />{:else}<DocumentArrowUp
								className="size-4"
							/>{/if}
					</button>
				</Tooltip>
			{/if}

			{#if showClose}
				<Tooltip content={$i18n.t('Close')}>
					<button
						type="button"
						class="rounded-lg p-1 transition hover:bg-gray-100 dark:hover:bg-gray-900"
						aria-label={$i18n.t('Close')}
						on:mousedown|stopPropagation
						on:click|stopPropagation={() => dispatch('close')}
					>
						<XMark className="size-4" />
					</button>
				</Tooltip>
			{/if}
		</div>
	</div>

	{#if conflict}
		<ArtifactConflict
			before={`${serverVersion?.title ?? title}\n\n${serverVersion?.content ?? content}`}
			after={`${conflict.title}\n\n${conflict.content}`}
			busy={resolving}
			onRecover={() => resolveConflict(true)}
			onDiscard={() => resolveConflict(false)}
		/>
	{:else if transientSaveError}
		<p role="status" class="px-4 pt-2 text-xs text-red-600 dark:text-red-400">
			{$i18n.t('Changes could not be saved')}
		</p>
		<button
			type="button"
			class="p-2 text-xs underline"
			on:click={() => queueTransientSave(titleValue, md, titleEdited)}
			>{$i18n.t('Retry saving')}</button
		>
	{/if}
	<CanvasSelectionEditor
		{editor}
		{selection}
		disabled={!!conflict || resolving}
		onAdd={askAboutSelection}
	/>
	<div class="canvas-document-content min-h-0 flex-1 overflow-auto px-4 pb-4 pt-2" role="group">
		{#key canvasId}
			<RichTextInput
				bind:this={richTextInput}
				bind:editor
				id={`canvas-${canvasId}`}
				className="input-prose-sm min-h-[20rem] px-0.5"
				{value}
				documentId={`canvas:${canvasId}`}
				collaboration={false}
				socket={$socket as any}
				user={$user as any}
				dragHandle={true}
				link={true}
				image={true}
				fileHandler={false}
				placeholder={$i18n.t('Write something...')}
				editable={!conflict && !resolving}
				onChange={(nextContent: any) => {
					const isManualChange = !isApplyingExternalContent && nextContent.md !== md;
					html = nextContent.html;
					md = nextContent.md;
					json = nextContent.json;
					if (isManualChange) {
						lastLocalContent = md;
						updateCanvasState({ content: md, canUndoAiUpdate: false });
						queueTransientSave(titleValue, md, titleEdited);
					}
				}}
			/>
		{/key}
	</div>
</div>

<style>
	/* Keep the opening text clear of the floating actions, without adding a header row. */
	.canvas-document-content :global(.tiptap > :first-child:not(.canvas-removed-text)),
	.canvas-document-content :global(.tiptap > .canvas-removed-text:first-child > :first-child) {
		padding-inline-end: 8.5rem;
	}
</style>
