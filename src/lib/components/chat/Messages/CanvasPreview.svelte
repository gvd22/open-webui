<script lang="ts">
	import { getContext } from 'svelte';
	import type { Writable } from 'svelte/store';
	import type { i18n as i18nType } from 'i18next';

	import { toast } from 'svelte-sonner';
	import { selectTransientCanvasDocument } from '$lib/apis/chats';
	import {
		artifactCode,
		artifactContents,
		chatId,
		showArtifacts,
		showControls,
		showEmbeds
	} from '$lib/stores';
	import Document from '$lib/components/icons/Document.svelte';
	import Pencil from '$lib/components/icons/Pencil.svelte';
	import { generateCanvasTitle } from '../Artifacts/canvas';
	import Markdown from './Markdown.svelte';

	const i18n: Writable<i18nType> = getContext('i18n');

	export let title = '';
	export let content = '';
	export let canvasId = '';
	export let noteId = '';
	export let model = null;
	export let save = false;
	export let preview = false;
	export let compactPreview = false;
	export let done = true;
	export let editCodeBlock = true;
	export let topPadding = false;
	export let sourceIds: string[] = [];
	export let onSave: any = () => {};
	export let onSourceClick: any = () => {};
	export let onTaskClick: any = () => {};
	export let onUpdate: any = () => {};
	export let onPreview: any = () => {};

	$: selectedId = canvasId || noteId || content;
	$: currentArtifact = (($artifactContents ?? []) as any[]).find(
		(item) => item?.type === 'canvas-note' && (item.canvasId === canvasId || item.noteId === noteId)
	);
	$: currentContent = currentArtifact?.content ?? content;
	$: currentTitle = currentArtifact?.title ?? title;
	$: generatedTitle = generateCanvasTitle(currentContent, currentTitle);
	$: isSelected = $showArtifacts && $artifactCode === selectedId;

	const openEditor = async () => {
		if ($chatId && canvasId) {
			try {
				const document = await selectTransientCanvasDocument(localStorage.token, $chatId, canvasId);
				(artifactContents as any).update((items: any[]) =>
					(items ?? []).map((item) =>
						item?.canvasId === canvasId
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
			}
		}
		artifactCode.set(selectedId as any);
		showEmbeds.set(false);
		if (!$showArtifacts) showArtifacts.set(true);
		if (!$showControls) showControls.set(true);
	};
</script>

{#if $showArtifacts}
	<button
		type="button"
		class="my-2 flex w-fit max-w-full items-center gap-2.5 rounded-lg border px-3 py-2 text-left transition {isSelected
			? 'border-gray-300 bg-gray-50 text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100'
			: 'border-gray-200 bg-white text-gray-800 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-200 dark:hover:bg-gray-900'}"
		aria-label={`${$i18n.t('Bearbeiten')}: ${generatedTitle || $i18n.t('Untitled')}`}
		on:click={openEditor}
	>
		<span
			class="flex size-8 shrink-0 items-center justify-center rounded-md bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300"
		>
			<Document className="size-4" />
		</span>
		<span class="max-w-64 min-w-0 truncate text-sm font-medium">
			{generatedTitle || $i18n.t('Untitled')}
		</span>
		<Pencil className="size-3.5 shrink-0 text-gray-400" strokeWidth="1.8" />
	</button>
{:else}
	<div
		class="my-2 max-w-2xl rounded-xl border border-gray-200 bg-white text-gray-900 shadow-sm dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100"
		dir="ltr"
	>
		<div class="flex items-start justify-between gap-4 px-4 py-3">
			<div class="min-w-0 flex-1">
				<div class="truncate text-sm font-semibold">
					{generatedTitle || $i18n.t('Untitled')}
				</div>
				<div class="markdown-prose mt-3 max-w-none">
					<Markdown
						id={`canvas-preview-${selectedId}`}
						content={currentContent}
						{model}
						{save}
						{preview}
						{compactPreview}
						{done}
						{editCodeBlock}
						{topPadding}
						{sourceIds}
						{onSourceClick}
						{onTaskClick}
						{onSave}
						{onUpdate}
						{onPreview}
					/>
				</div>
			</div>

			<button
				class="mt-0.5 flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-gray-700 transition hover:bg-gray-100 hover:text-gray-900 dark:text-gray-200 dark:hover:bg-gray-900 dark:hover:text-white"
				aria-label={$i18n.t('Bearbeiten')}
				on:click={openEditor}
			>
				<Pencil className="size-3.5" strokeWidth="1.8" />
				{$i18n.t('Bearbeiten')}
			</button>
		</div>
	</div>
{/if}
