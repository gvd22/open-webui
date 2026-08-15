<script lang="ts">
	import { createEventDispatcher, getContext, onDestroy } from 'svelte';
	import type { Writable } from 'svelte/store';
	import type { i18n as i18nType } from 'i18next';

	import NoteEditor from '$lib/components/notes/NoteEditor.svelte';
	import { undoLastTransientCanvasAiUpdate, updateTransientCanvasDocument } from '$lib/apis/chats';
	import { artifactContents, config, user } from '$lib/stores';
	import CanvasEditor from './CanvasEditor.svelte';
	import { canSynchronizeCanvasDocumentChange, canUseNotes } from './canvas';

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
	let linkedSaveTimer: ReturnType<typeof setTimeout> | null = null;
	let pendingWorkspaceDocument: {
		canvasId: string;
		title: string;
		content: string;
	} | null = null;
	let isApplyingExternalDocument = false;
	let suppressWorkspaceSyncUntil = Date.now() + 300;

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

	onDestroy(() => {
		if (linkedSaveTimer) {
			clearTimeout(linkedSaveTimer);
			linkedSaveTimer = null;
			if (pendingWorkspaceDocument) {
				void saveCanvasContext(pendingWorkspaceDocument);
			}
		}
	});

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
							canUndoAiUpdate: isManualChange ? false : item.canUndoAiUpdate
						}
					: item
			)
		);
	};

	const saveCanvasContext = async (documentToSave: {
		canvasId: string;
		title: string;
		content: string;
	}) => {
		if (!chatId || !documentToSave.canvasId) {
			return;
		}

		try {
			const document = await updateTransientCanvasDocument(
				localStorage.token,
				chatId,
				documentToSave.canvasId,
				{
					title: documentToSave.title,
					content: documentToSave.content,
					title_edited: true
				}
			);
			(artifactContents as any).update((items: any[]) =>
				(items ?? []).map((item) =>
					item?.canvasId === documentToSave.canvasId
						? {
								...item,
								title: document.title,
								content: document.content,
								updatedAt: document.updated_at,
								titleEdited: Boolean(document.title_edited)
							}
						: item
				)
			);
			if (pendingWorkspaceDocument === documentToSave) {
				pendingWorkspaceDocument = null;
			}
		} catch (error) {
			console.error('Unable to synchronize Canvas context', error);
		}
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

		if (!isManualChange || !chatId || !canvasId) {
			return;
		}

		if (linkedSaveTimer) {
			clearTimeout(linkedSaveTimer);
		}
		const documentToSave = {
			canvasId,
			title: linkedTitle,
			content: linkedContent
		};
		pendingWorkspaceDocument = documentToSave;
		linkedSaveTimer = setTimeout(async () => {
			try {
				linkedSaveTimer = null;
				await saveCanvasContext(documentToSave);
			} finally {
				linkedSaveTimer = null;
			}
		}, 500);
	};

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
								updatedAt: document.updated_at
							}
						: item
				)
			);
		} catch (error) {
			console.error('Unable to undo Canvas AI update', error);
		}
	};
</script>

{#if noteId && notesAvailable}
	<div class="h-full min-h-0 bg-white text-gray-900 dark:bg-gray-950 dark:text-gray-100">
		<NoteEditor
			id={noteId}
			canvas={true}
			showCanvasClose={showClose}
			canUndoCanvasAiUpdate={canUndoAiUpdate}
			onClose={() => dispatch('close')}
			onTitleChange={updateWorkspaceTitle}
			onDocumentChange={updateWorkspaceDocument}
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
			{noteId}
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
