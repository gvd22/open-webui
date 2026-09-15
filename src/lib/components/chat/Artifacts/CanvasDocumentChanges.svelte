<script lang="ts">
	import { getContext, onDestroy } from 'svelte';
	import { get } from 'svelte/store';
	import { marked } from 'marked';
	import DOMPurify from 'dompurify';
	import { DOMParser } from '@tiptap/pm/model';
	import { Plugin, PluginKey } from '@tiptap/pm/state';
	import { DecorationSet } from '@tiptap/pm/view';
	import { toast } from 'svelte-sonner';
	import { artifactContents, chatId as activeChatId } from '$lib/stores';
	import { selectTransientCanvasDocument } from '$lib/apis/chats';
	import { undoLastTransientCanvasAiUpdate } from '$lib/apis/artifacts';
	import { flushWorkspaceSaveBarrier, resetWorkspaceSaveVersion } from './serializedSaveQueue';
	import { canvasChangeDecorations } from './canvasChangeDecorations';
	import Tooltip from '$lib/components/common/Tooltip.svelte';
	import Eye from '$lib/components/icons/Eye.svelte';
	import ArrowUturnLeft from '$lib/components/icons/ArrowUturnLeft.svelte';

	export let editor: any;
	export let canvasId: string;
	export let chatId: string;
	export let disabled = false;
	const i18n = getContext<any>('i18n');
	const key = new PluginKey('canvas-document-changes');
	let expanded = false;
	let busy = false;
	let disposed = false;
	let decoratedEditor: any = null;
	let version: { expected_updated_at: number; expected_content_hash: string } | null = null;
	$: artifact = ($artifactContents ?? [])
		.filter((item) => item.type === 'canvas-note')
		.find((item) => item.canvasId === canvasId);
	const hide = () => {
		if (decoratedEditor && !decoratedEditor.isDestroyed) {
			decoratedEditor.off('update', hide);
			decoratedEditor.unregisterPlugin(key);
		}
		decoratedEditor = null;
		expanded = false;
		version = null;
	};
	$: if (
		expanded &&
		(disabled ||
			editor !== decoratedEditor ||
			!artifact?.canUndoAiUpdate ||
			artifact?.updatedAt !== version?.expected_updated_at)
	)
		hide();
	const show = async () => {
		if (busy || disabled || !editor) return;
		const targetChat = chatId,
			targetId = canvasId,
			targetEditor = editor;
		busy = true;
		try {
			if (!(await flushWorkspaceSaveBarrier({ chatId: targetChat, kind: 'canvas', id: targetId })))
				return;
			const doc = targetEditor.state.doc;
			const current = await selectTransientCanvasDocument(localStorage.token, targetChat, targetId);
			if (
				disposed ||
				get(activeChatId) !== targetChat ||
				canvasId !== targetId ||
				editor !== targetEditor
			)
				return;
			if (
				doc !== editor.state.doc ||
				current.contentHash !== artifact?.contentHash ||
				current.updated_at !== artifact?.updatedAt
			)
				throw new Error('Canvas changed elsewhere. The latest version was loaded.');
			if (typeof current.last_ai_update?.content !== 'string') return;
			const body = document.createElement('div');
			body.innerHTML = DOMPurify.sanitize(
				marked.parse(current.last_ai_update.content, { async: false }) as string
			);
			const before = DOMParser.fromSchema(editor.schema).parse(body);
			const decorations = canvasChangeDecorations(before, doc);
			version = {
				expected_updated_at: current.updated_at,
				expected_content_hash: current.contentHash
			};
			editor.registerPlugin(
				new Plugin({
					key,
					state: {
						init: () => decorations,
						apply: (transaction, value) => (transaction.docChanged ? DecorationSet.empty : value)
					},
					props: { decorations: (state) => key.getState(state) }
				})
			);
			decoratedEditor = editor;
			editor.on('update', hide);
			expanded = true;
		} catch (error) {
			toast.error($i18n.t('Could not load changes. Please try again.'));
		} finally {
			busy = false;
		}
	};
	const undo = async () => {
		if (busy || disabled || !version) return;
		const targetChat = chatId,
			targetId = canvasId,
			expected = version;
		busy = true;
		try {
			if (!(await flushWorkspaceSaveBarrier({ chatId: targetChat, kind: 'canvas', id: targetId })))
				return;
			if (disposed || get(activeChatId) !== targetChat) return;
			const current = await undoLastTransientCanvasAiUpdate(
				localStorage.token,
				targetChat,
				targetId,
				expected
			);
			if (disposed || get(activeChatId) !== targetChat || canvasId !== targetId) return;
			hide();
			resetWorkspaceSaveVersion(
				{ chatId: targetChat, kind: 'canvas', id: targetId },
				{ updatedAt: current.updated_at, contentHash: current.contentHash }
			);
			artifactContents.update((items) =>
				(items ?? []).map((item) =>
					item.type === 'canvas-note' && item.canvasId === targetId
						? {
								...item,
								title: current.title,
								content: current.content,
								titleEdited: current.title_edited,
								updatedAt: current.updated_at,
								contentHash: current.contentHash,
								canUndoAiUpdate: false
							}
						: item
				)
			);
		} catch (error: any) {
			toast.error(
				$i18n.t(
					error?.status === 409
						? 'This change is no longer the latest. Nothing was overwritten.'
						: 'AI change could not be undone'
				)
			);
		} finally {
			busy = false;
		}
	};
	onDestroy(() => {
		disposed = true;
		hide();
	});
</script>

{#if artifact?.canUndoAiUpdate && editor}
	<div class="flex shrink-0 items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
		{#if expanded}
			<Tooltip content={$i18n.t('Undo AI change')}>
				<button
					type="button"
					disabled={busy || disabled}
					aria-label={$i18n.t('Undo AI change')}
					class="flex size-8 items-center justify-center rounded-md transition hover:bg-gray-100 hover:text-gray-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-40 dark:hover:bg-gray-800 dark:hover:text-gray-100"
					on:click={undo}><ArrowUturnLeft className="size-4" /></button
				>
			</Tooltip>
		{/if}
		<Tooltip content={$i18n.t(expanded ? 'Hide changes' : 'Show changes')}>
			<button
				type="button"
				class="flex h-8 items-center justify-center gap-1.5 rounded-md px-2 transition hover:bg-gray-100 hover:text-gray-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-40 dark:hover:bg-gray-800 dark:hover:text-gray-100 {expanded
					? 'bg-gray-100 text-gray-900 dark:bg-gray-800 dark:text-gray-100'
					: ''}"
				disabled={busy || disabled}
				aria-label={$i18n.t(expanded ? 'Hide changes' : 'Show changes')}
				aria-busy={busy}
				aria-pressed={expanded}
				on:click={() => (expanded ? hide() : show())}
			>
				<Eye className="size-4" />
			</button>
		</Tooltip>
	</div>
{/if}

<style>
	:global(.canvas-removed-text) {
		margin-inline-end: 0.15em;
		background: rgb(239 68 68 / 10%);
		color: #991b1b;
		text-decoration-color: rgb(239 68 68 / 50%);
		text-decoration-line: line-through;
		white-space: pre-wrap;
	}
	:global(.canvas-added-text) {
		background: rgb(34 197 94 / 10%);
		color: #166534;
	}
	:global(.dark .canvas-removed-text) {
		color: #fecaca;
	}
	:global(.dark .canvas-added-text) {
		color: #bbf7d0;
	}
</style>
