<script lang="ts">
	import { createEventDispatcher, getContext, onDestroy, onMount } from 'svelte';
	import { get } from 'svelte/store';
	import type { Writable } from 'svelte/store';
	import type { i18n as i18nType } from 'i18next';
	import { toast } from 'svelte-sonner';

	import RichTextInput from '$lib/components/common/RichTextInput.svelte';
	import ArtifactConflict from './ArtifactConflict.svelte';
	import ArtifactComparison from './ArtifactComparison.svelte';
	import {
		draftKey,
		readConflictDraft,
		keepConflictDraft,
		clearConflictDraft,
		canvasSelection,
		WORKSPACE_ASK_AI_EVENT
	} from './artifactEditing';
	import Tooltip from '$lib/components/common/Tooltip.svelte';
	import ArrowUturnLeft from '$lib/components/icons/ArrowUturnLeft.svelte';
	import XMark from '$lib/components/icons/XMark.svelte';
	import { artifactContents, config, socket, user } from '$lib/stores';
	import {
		promoteTransientCanvasDocument,
		selectTransientCanvasDocument,
		undoLastTransientCanvasAiUpdate,
		updateTransientCanvasDocument
	} from '$lib/apis/chats';
	import { canSynchronizeCanvasDocumentChange, canUseNotes, generateCanvasTitle } from './canvas';
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
	let transientSaveError = false;
	let lastLocalContent = '';
	let isApplyingExternalContent = false;
	let suppressExternalSaveUntil = Date.now() + 300;
	let richTextInput: any = null;
	let unregisterSaveBarrier = () => {};
	let conflict: { title: string; content: string; titleEdited: boolean } | null = null;
	let serverVersion: any = null;
	let resolving = false;
	let disposed = false;
	let localPending = false;
	let comparison: { before: string; after: string } | null = null;
	let selection = '';
	let selectionEditor: any = null;
	let instruction = '';
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
	const askAboutSelection = async () => {
		const selected = canvasSelection(md, selection.trim());
		if (!selected) {
			toast.warning($i18n.t('Select a unique passage of at most 8,000 characters.'));
			return;
		}
		const targetChat = chatId,
			targetId = canvasId;
		await transientSaveQueue.flush();
		if (
			disposed ||
			transientSaveError ||
			conflict ||
			chatId !== targetChat ||
			canvasId !== targetId
		)
			return;
		const current = (get(artifactContents) ?? []).find(
			(item: any) => item.canvasId === canvasId
		) as any;
		if (!current?.contentHash) return;
		let saved;
		try {
			saved = await selectTransientCanvasDocument(localStorage.token, targetChat, targetId);
		} catch {
			toast.error($i18n.t('Could not verify this selection. Please try again.'));
			return;
		}
		if (disposed || chatId !== targetChat || canvasId !== targetId) return;
		if (
			saved.contentHash !== current.contentHash ||
			!canvasSelection(saved.content ?? '', selected)
		) {
			toast.warning(
				$i18n.t(
					'This selection does not match the saved source. Reopen the Canvas and select a smaller passage.'
				)
			);
			return;
		}
		window.dispatchEvent(
			new CustomEvent(WORKSPACE_ASK_AI_EVENT, {
				detail: {
					chatId,
					focus: {
						kind: 'canvas',
						id: canvasId,
						selection: { text: selected, contentHash: current.contentHash }
					},
					prompt:
						instruction.trim() ||
						'Improve the selected passage. Keep the rest of the Canvas unchanged.'
				}
			})
		);
	};
	const showAiChanges = async () => {
		const targetChat = chatId,
			targetId = canvasId;
		try {
			const current = await selectTransientCanvasDocument(localStorage.token, targetChat, targetId);
			if (!disposed && chatId === targetChat && canvasId === targetId && current.last_ai_update)
				comparison = { before: current.last_ai_update.content ?? '', after: current.content ?? '' };
		} catch {
			toast.error($i18n.t('Changes could not be loaded.'));
		}
	};

	$: generatedTitle = titleValue || generateCanvasTitle(md || value || content, title);
	$: if (!conflict && !localPending && title !== lastTitleProp && title !== titleValue) {
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

	const updateTitle = (event: Event) => {
		comparison = null;
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
				updatedAt: document.updated_at,
				contentHash: document.contentHash
			});
			toast.success($i18n.t('AI change undone'), { position: 'bottom-right' });
			comparison = null;
		} catch (error: any) {
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
					disabled={!!conflict || resolving}
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
						class="rounded-md px-2 py-1.5 text-xs hover:bg-gray-100 dark:hover:bg-gray-800"
						on:click={showAiChanges}>{$i18n.t('Changes')}</button
					>
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

	{#if conflict}
		<ArtifactConflict
			before={`${serverVersion?.title ?? title}\n\n${serverVersion?.content ?? content}`}
			after={`${conflict.title}\n\n${conflict.content}`}
			busy={resolving}
			onRecover={() => resolveConflict(true)}
			onDiscard={() => resolveConflict(false)}
		/>
	{:else if transientSaveError}
		<button
			type="button"
			class="p-2 text-xs underline"
			on:click={() => queueTransientSave(titleValue, md, titleEdited)}
			>{$i18n.t('Retry saving')}</button
		>
	{/if}
	{#if comparison}
		<div class="shrink-0 border-y border-gray-100 dark:border-gray-800">
			<button type="button" class="px-3 pt-2 text-xs underline" on:click={() => (comparison = null)}
				>{$i18n.t('Close comparison')}</button
			><ArtifactComparison before={comparison.before} after={comparison.after} />
		</div>
	{/if}
	{#if selection && !conflict}
		<div
			class="flex shrink-0 flex-wrap gap-2 border-y border-gray-100 px-4 py-2 dark:border-gray-800"
		>
			<input
				class="min-w-0 flex-1 bg-transparent text-sm outline-none"
				aria-label={$i18n.t('Selection instruction')}
				placeholder={$i18n.t('Improve this passage...')}
				bind:value={instruction}
			/>
			<button
				type="button"
				class="rounded-md bg-gray-100 px-2 py-1 text-xs dark:bg-gray-800"
				on:mousedown|preventDefault
				on:click={askAboutSelection}>{$i18n.t('Ask AI')}</button
			>
		</div>
	{/if}
	<div class="min-h-0 flex-1 overflow-auto px-4 pb-4" role="group">
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
					const isManualChange =
						canSynchronizeCanvasDocumentChange(
							isApplyingExternalContent,
							suppressExternalSaveUntil
						) && nextContent.md !== md;
					html = nextContent.html;
					md = nextContent.md;
					json = nextContent.json;
					if (isManualChange) {
						comparison = null;
						lastLocalContent = md;
						updateCanvasState({ content: md, canUndoAiUpdate: false });
						queueTransientSave(titleValue, md, titleEdited);
					}
				}}
			/>
		{/key}
	</div>
</div>
