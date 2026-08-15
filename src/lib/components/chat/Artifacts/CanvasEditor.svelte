<script lang="ts">
	import { createEventDispatcher, getContext, onDestroy } from 'svelte';
	import type { Writable } from 'svelte/store';
	import type { i18n as i18nType } from 'i18next';
	import { toast } from 'svelte-sonner';

	import RichTextInput from '$lib/components/common/RichTextInput.svelte';
	import Tooltip from '$lib/components/common/Tooltip.svelte';
	import ArrowUturnLeft from '$lib/components/icons/ArrowUturnLeft.svelte';
	import XMark from '$lib/components/icons/XMark.svelte';
	import { artifactContents, config, socket, user } from '$lib/stores';
	import {
		promoteTransientCanvasDocument,
		undoLastTransientCanvasAiUpdate,
		updateTransientCanvasDocument
	} from '$lib/apis/chats';
	import { canSynchronizeCanvasDocumentChange, canUseNotes, generateCanvasTitle } from './canvas';

	const i18n: Writable<i18nType> = getContext('i18n');
	const dispatch = createEventDispatcher();

	export let canvasId = '';
	export let chatId = '';
	export let title = '';
	export let content = '';
	export let titleEdited = false;
	export let canUndoAiUpdate = false;
	export let showClose = true;
	export let noteId = '';

	let editor: any = null;
	let value = content;
	let html = '';
	let md = content;
	let json: any = null;
	let titleValue = generateCanvasTitle(content, title);
	let lastTitleProp = title;
	let wordCount = 0;
	let charCount = 0;
	let saving = false;
	let linkedNoteId = noteId;
	$: if (noteId && noteId !== linkedNoteId) linkedNoteId = noteId;
	$: notesAvailable = canUseNotes(
		Boolean($config?.features?.enable_notes),
		$user?.role,
		$user?.permissions?.features?.notes
	);
	let lastContentProp = content;
	let transientSaveTimer: ReturnType<typeof setTimeout> | null = null;
	let transientSaveError = false;
	let lastLocalContent = '';
	let pendingTransientSave: { title: string; content: string; titleEdited: boolean } | null = null;
	let isApplyingExternalContent = false;
	let suppressExternalSaveUntil = Date.now() + 300;
	onDestroy(() => {
		if (transientSaveTimer) {
			clearTimeout(transientSaveTimer);
			transientSaveTimer = null;
			if (pendingTransientSave) {
				void saveTransientCanvas(pendingTransientSave);
			}
		}
	});

	$: generatedTitle = titleValue || generateCanvasTitle(md || value || content, title);
	$: if (title !== lastTitleProp && title !== titleValue) {
		lastTitleProp = title;
		titleValue = generateCanvasTitle(md || value || content, title);
	}
	const applyExternalContent = (nextContent: string) => {
		isApplyingExternalContent = true;
		suppressExternalSaveUntil = Date.now() + 300;
		value = nextContent;
		md = nextContent;
		html = '';
		json = null;
		lastLocalContent = nextContent;
		queueMicrotask(() => {
			isApplyingExternalContent = false;
		});
	};

	$: if (content !== lastContentProp) {
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

	const updateTitle = (event: Event) => {
		const nextTitle = (event.currentTarget as HTMLInputElement).value;
		titleValue = nextTitle;
		titleEdited = nextTitle.trim().length > 0;
		lastTitleProp = nextTitle;
		updateCanvasState({
			title: nextTitle || generateCanvasTitle(md || value || content, title),
			titleEdited,
			canUndoAiUpdate: false
		});
		queueTransientSave(nextTitle, md || value || content, titleEdited);
	};

	const saveTransientCanvas = async (nextSave: {
		title: string;
		content: string;
		titleEdited: boolean;
	}) => {
		if (!chatId || !canvasId) {
			return;
		}

		try {
			const document = await updateTransientCanvasDocument(localStorage.token, chatId, canvasId, {
				title: nextSave.title || generateCanvasTitle(nextSave.content, title),
				content: nextSave.content,
				title_edited: nextSave.titleEdited
			});
			updateCanvasState({
				updatedAt: document.updated_at,
				titleEdited: Boolean(document.title_edited)
			});
			if (pendingTransientSave === nextSave) {
				pendingTransientSave = null;
			}
			transientSaveError = false;
		} catch (error) {
			transientSaveError = true;
			console.error('Unable to save Canvas edit', error);
		}
	};

	const queueTransientSave = (nextTitle: string, nextContent: string, titleEdited: boolean) => {
		if (!chatId || !canvasId) {
			return;
		}
		const nextSave = { title: nextTitle, content: nextContent, titleEdited };
		pendingTransientSave = nextSave;

		if (transientSaveTimer) {
			clearTimeout(transientSaveTimer);
		}

		transientSaveTimer = setTimeout(async () => {
			transientSaveTimer = null;
			await saveTransientCanvas(nextSave);
		}, 500);
	};

	const addToNotes = async () => {
		if (saving || !notesAvailable) {
			return;
		}

		saving = true;
		try {
			const note = await promoteTransientCanvasDocument(localStorage.token, chatId, canvasId, {
				title: titleValue || generatedTitle,
				content: md || value || content,
				html,
				json
			});
			linkedNoteId = note?.id ?? '';

			if (linkedNoteId) {
				updateCanvasState({ noteId: linkedNoteId, title: titleValue || generatedTitle });
				toast.success($i18n.t('Added to notes'));
			}
		} catch (error) {
			toast.error(`${error}`);
		} finally {
			saving = false;
		}
	};

	const undoAiUpdate = async () => {
		if (!chatId || !canvasId) {
			console.error('Canvas undo requested without an active chat or document');
			return;
		}

		try {
			const document = await undoLastTransientCanvasAiUpdate(localStorage.token, chatId, canvasId);
			applyExternalContent(document.content);
			titleValue = document.title;
			titleEdited = Boolean(document.title_edited);
			updateCanvasState({
				title: document.title,
				content: document.content,
				titleEdited: Boolean(document.title_edited),
				canUndoAiUpdate: false,
				updatedAt: document.updated_at
			});
			toast.success($i18n.t('AI change undone'));
		} catch (error) {
			toast.error(error?.detail ?? $i18n.t('AI change could not be undone'));
		}
	};

	$: if (editor) {
		wordCount = editor.storage.characterCount.words();
		charCount = editor.storage.characterCount.characters();
	}
</script>

<div
	class="flex h-full min-h-0 flex-col bg-white text-gray-900 dark:bg-gray-950 dark:text-gray-100"
>
	<div class="shrink-0 px-4 pb-2 pt-3">
		<div class="flex items-start justify-between gap-3">
			<div class="min-w-0">
				<input
					class="w-full rounded-md bg-transparent px-0 py-0.5 text-sm font-semibold outline-none transition focus:bg-gray-50 focus:px-1.5 dark:focus:bg-gray-900"
					value={titleValue}
					aria-label={$i18n.t('Title')}
					on:input={updateTitle}
					on:blur={() => {
						if (!titleValue.trim()) {
							titleValue = generateCanvasTitle(md || value || content, title);
							titleEdited = false;
							updateCanvasState({ title: titleValue, titleEdited: false });
							queueTransientSave(titleValue, md || value || content, false);
						}
					}}
				/>
				<div class="mt-1 flex flex-wrap gap-2 text-xs text-gray-500 dark:text-gray-400">
					<span>{$i18n.t('{{COUNT}} words', { COUNT: wordCount })}</span>
					<span>{$i18n.t('{{COUNT}} characters', { COUNT: charCount })}</span>
					{#if transientSaveError}<span>{$i18n.t('Changes could not be saved')}</span>{/if}
				</div>
			</div>

			<div class="flex shrink-0 items-center gap-1">
				{#if canUndoAiUpdate}
					<button
						type="button"
						class="rounded-lg p-1.5 text-gray-600 transition hover:bg-gray-100 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-gray-900 dark:hover:text-white"
						aria-label={$i18n.t('Undo AI change')}
						title={$i18n.t('Undo AI change')}
						on:mousedown|preventDefault|stopPropagation
						on:click={undoAiUpdate}
					>
						<ArrowUturnLeft className="size-4" />
					</button>
				{/if}

				{#if notesAvailable}
					<button
						type="button"
						class="rounded-lg px-2.5 py-1.5 text-xs font-medium text-gray-700 transition hover:bg-gray-100 hover:text-gray-900 disabled:opacity-50 dark:text-gray-200 dark:hover:bg-gray-900 dark:hover:text-white"
						disabled={saving || !!linkedNoteId}
						on:mousedown|preventDefault|stopPropagation={addToNotes}
						on:click={addToNotes}
					>
						{linkedNoteId
							? $i18n.t('In Notizen')
							: saving
								? $i18n.t('Saving...')
								: $i18n.t('Zu Notizen hinzufügen')}
					</button>
				{:else if linkedNoteId}
					<span class="px-2 text-xs text-gray-400 dark:text-gray-500">
						{$i18n.t('Linked note is kept in sync')}
					</span>
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
	</div>

	<div class="min-h-0 flex-1 overflow-auto px-4 pb-4">
		{#key canvasId}
			<RichTextInput
				bind:editor
				id={`canvas-${canvasId}`}
				className="input-prose-sm min-h-[20rem] px-0.5"
				bind:value
				documentId={`canvas:${canvasId}`}
				collaboration={false}
				socket={$socket as any}
				user={$user as any}
				dragHandle={true}
				link={true}
				image={true}
				fileHandler={false}
				placeholder={$i18n.t('Write something...')}
				editable={true}
				onChange={(nextContent: any) => {
					const isManualChange =
						canSynchronizeCanvasDocumentChange(
							isApplyingExternalContent,
							suppressExternalSaveUntil
						) && nextContent.md !== md;
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
