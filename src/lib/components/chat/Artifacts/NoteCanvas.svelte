<script lang="ts">
	import { createEventDispatcher, getContext, onDestroy, onMount } from 'svelte';
	import { get } from 'svelte/store';
	import type { Writable } from 'svelte/store';
	import type { i18n as i18nType } from 'i18next';
	import { toast } from 'svelte-sonner';

	import NoteEditor from '$lib/components/notes/NoteEditor.svelte';
	import {
		selectTransientCanvasDocument,
		undoLastTransientCanvasAiUpdate,
		updateTransientCanvasDocument
	} from '$lib/apis/chats';
	import { artifactContents, config, user } from '$lib/stores';
	import CanvasEditor from './CanvasEditor.svelte';
	import { canSynchronizeCanvasDocumentChange, canUseNotes } from './canvas';
	import {
		createSerializedSaveQueue,
		registerWorkspaceSaveBarrier,
		resetWorkspaceSaveVersion,
		runWorkspaceOptimisticSave
	} from './serializedSaveQueue';

	const i18n: Writable<i18nType> = getContext('i18n');
	const dispatch = createEventDispatcher();

	export let noteId = '';
	export let chatId = '';
	export let canvasId = '';
	export let title = '';
	export let content = '';
	export let titleEdited = false;
	export let canUndoAiUpdate = false;
	export let showClose = true;
	$: notesAvailable = canUseNotes(
		Boolean($config?.features?.enable_notes),
		$user?.role,
		$user?.permissions?.features?.notes
	);

	let linkedTitle = title;
	let linkedContent = content;
	let lastTitleProp = title;
	let lastContentProp = content;
	let isApplyingExternalDocument = false;
	let suppressWorkspaceSyncUntil = Date.now() + 300;
	let linkedNoteUnavailable = false;
	let saveConflict = false;
	let unregisterSaveBarrier = () => {};

	const markExternalDocumentUpdate = () => {
		isApplyingExternalDocument = true;
		suppressWorkspaceSyncUntil = Date.now() + 300;
		queueMicrotask(() => {
			isApplyingExternalDocument = false;
		});
	};

	$: if (title !== lastTitleProp) {
		lastTitleProp = title;
		linkedTitle = title;
		markExternalDocumentUpdate();
	}
	$: if (content !== lastContentProp) {
		lastContentProp = content;
		linkedContent = content;
		markExternalDocumentUpdate();
	}

	const updateWorkspaceTitle = (nextTitle: string) => {
		const isManualChange =
			canSynchronizeCanvasDocumentChange(isApplyingExternalDocument, suppressWorkspaceSyncUntil) &&
			nextTitle !== linkedTitle;
		linkedTitle = nextTitle;
		if (!isManualChange) {
			return;
		}
		(artifactContents as any).update((items: any[]) =>
			(items ?? []).map((item) =>
				item?.canvasId === canvasId || item?.noteId === noteId
					? {
							...item,
							title: nextTitle,
							titleEdited: true,
							canUndoAiUpdate: isManualChange ? false : item.canUndoAiUpdate
						}
					: item
			)
		);
		queueWorkspaceSave();
	};

	const saveCanvasContext = async (documentToSave: {
		targetChatId: string;
		canvasId: string;
		title: string;
		content: string;
		expectedUpdatedAt?: number;
		expectedContentHash?: string;
	}) => {
		if (!documentToSave.targetChatId || !documentToSave.canvasId) {
			return;
		}

		try {
			const document = await runWorkspaceOptimisticSave(
				{
					chatId: documentToSave.targetChatId,
					kind: 'canvas',
					id: documentToSave.canvasId
				},
				{
					updatedAt: documentToSave.expectedUpdatedAt,
					contentHash: documentToSave.expectedContentHash
				},
				async (version) => {
					const saved = await updateTransientCanvasDocument(
						localStorage.token,
						documentToSave.targetChatId,
						documentToSave.canvasId,
						{
							title: documentToSave.title,
							content: documentToSave.content,
							title_edited: true,
							expected_updated_at: version.updatedAt ?? null,
							expected_content_hash: version.contentHash ?? null
						}
					);
					return { ...saved, updatedAt: saved.updated_at };
				}
			);
			if (chatId !== documentToSave.targetChatId || canvasId !== documentToSave.canvasId) return;
			(artifactContents as any).update((items: any[]) =>
				(items ?? []).map((item) =>
					item?.canvasId === documentToSave.canvasId
						? {
								...item,
								title: document.title,
								content: document.content,
								updatedAt: document.updated_at,
								contentHash: document.contentHash,
								titleEdited: Boolean(document.title_edited)
							}
						: item
				)
			);
			saveConflict = false;
		} catch (error: any) {
			if (chatId !== documentToSave.targetChatId || canvasId !== documentToSave.canvasId) return;
			saveConflict = true;
			if (error?.status === 409) {
				try {
					const document = await selectTransientCanvasDocument(
						localStorage.token,
						documentToSave.targetChatId,
						documentToSave.canvasId
					);
					linkedTitle = document.title ?? linkedTitle;
					linkedContent = document.content ?? linkedContent;
					(artifactContents as any).update((items: any[]) =>
						(items ?? []).map((item) =>
							item?.canvasId === documentToSave.canvasId
								? {
										...item,
										title: linkedTitle,
										content: linkedContent,
										updatedAt: document.updated_at,
										contentHash: document.contentHash
									}
								: item
						)
					);
					resetWorkspaceSaveVersion(
						{
							chatId: documentToSave.targetChatId,
							kind: 'canvas',
							id: documentToSave.canvasId
						},
						{ updatedAt: document.updated_at, contentHash: document.contentHash }
					);
					saveConflict = false;
				} catch (refreshError) {
					console.error('Unable to reload conflicted Canvas', refreshError);
					toast.error($i18n.t('Canvas changed elsewhere and could not be reloaded.'));
					return;
				}
				toast.warning($i18n.t('Canvas changed elsewhere. The latest version was loaded.'));
				return;
			}
			console.error('Unable to synchronize Canvas context', error);
		}
	};
	const workspaceSaveQueue = createSerializedSaveQueue(saveCanvasContext);

	const queueWorkspaceSave = () => {
		if (!chatId || !canvasId) return;
		const current = ((get(artifactContents) ?? []) as any[]).find(
			(item) => item?.canvasId === canvasId
		);
		workspaceSaveQueue.enqueue({
			targetChatId: chatId,
			canvasId,
			title: linkedTitle,
			content: linkedContent,
			expectedUpdatedAt: current?.updatedAt,
			expectedContentHash: current?.contentHash
		});
	};

	const updateWorkspaceDocument = (updates: { title?: string; content?: string }) => {
		const isManualChange =
			canSynchronizeCanvasDocumentChange(isApplyingExternalDocument, suppressWorkspaceSyncUntil) &&
			((updates.title !== undefined && updates.title !== linkedTitle) ||
				(updates.content !== undefined && updates.content !== linkedContent));
		linkedTitle = updates.title ?? linkedTitle;
		linkedContent = updates.content ?? linkedContent;
		if (!isManualChange) {
			return;
		}

		(artifactContents as any).update((items: any[]) =>
			(items ?? []).map((item) =>
				item?.canvasId === canvasId || item?.noteId === noteId
					? {
							...item,
							...updates,
							titleEdited: true,
							canUndoAiUpdate: isManualChange ? false : item.canUndoAiUpdate
						}
					: item
			)
		);

		queueWorkspaceSave();
	};

	const markLinkedNoteUnavailable = () => {
		linkedNoteUnavailable = true;
		(artifactContents as any).update((items: any[]) =>
			(items ?? []).map((item) =>
				item?.canvasId === canvasId ? { ...item, noteId: undefined } : item
			)
		);
	};

	onMount(() => {
		unregisterSaveBarrier = registerWorkspaceSaveBarrier(
			{ chatId, kind: 'canvas', id: canvasId },
			async () => {
				await workspaceSaveQueue.flush();
				return !saveConflict;
			}
		);
	});

	onDestroy(() => {
		void workspaceSaveQueue.flush().finally(unregisterSaveBarrier);
	});

	const undoAiUpdate = async () => {
		if (!chatId || !canvasId) {
			console.error('Canvas undo requested without an active chat or document');
			return;
		}

		try {
			const document = await undoLastTransientCanvasAiUpdate(localStorage.token, chatId, canvasId);
			linkedTitle = document.title;
			linkedContent = document.content;
			(artifactContents as any).update((items: any[]) =>
				(items ?? []).map((item) =>
					item?.canvasId === canvasId
						? {
								...item,
								title: document.title,
								content: document.content,
								titleEdited: Boolean(document.title_edited),
								canUndoAiUpdate: false,
								updatedAt: document.updated_at,
								contentHash: document.contentHash
							}
						: item
				)
			);
		} catch (error) {
			console.error('Unable to undo Canvas AI update', error);
		}
	};
</script>

{#if noteId && notesAvailable && !linkedNoteUnavailable}
	<div class="h-full min-h-0 bg-white text-gray-900 dark:bg-gray-950 dark:text-gray-100">
		<NoteEditor
			id={noteId}
			canvas={true}
			showCanvasClose={showClose}
			canUndoCanvasAiUpdate={canUndoAiUpdate}
			onClose={() => dispatch('close')}
			onTitleChange={updateWorkspaceTitle}
			onDocumentChange={updateWorkspaceDocument}
			onUnavailable={markLinkedNoteUnavailable}
			onUndoCanvasAiUpdate={undoAiUpdate}
		/>
	</div>
{:else if canvasId}
	{#key canvasId}
		<CanvasEditor
			{chatId}
			{canvasId}
			{title}
			{content}
			{titleEdited}
			{canUndoAiUpdate}
			{showClose}
			noteId={linkedNoteUnavailable ? '' : noteId}
			on:close={() => dispatch('close')}
		/>
	{/key}
{:else}
	<div
		class="flex h-full items-center justify-center bg-white px-6 text-center text-sm text-gray-500 dark:bg-gray-950 dark:text-gray-400"
	>
		{$i18n.t('Canvas document could not be opened.')}
	</div>
{/if}
