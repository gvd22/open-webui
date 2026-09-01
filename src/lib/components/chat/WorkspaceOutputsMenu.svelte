<script lang="ts">
	import { getContext } from 'svelte';
	import type { Writable } from 'svelte/store';
	import type { i18n as i18nType } from 'i18next';
	import {
		artifactContents,
		showArtifacts,
		showControls,
		workspaceOpenRequestId,
		workspaceOutputFiles
	} from '$lib/stores';
	import Dropdown from '$lib/components/common/Dropdown.svelte';
	import DropdownMenu from '$lib/components/common/DropdownMenu.svelte';
	import Tooltip from '$lib/components/common/Tooltip.svelte';
	import ListBullet from '$lib/components/icons/ListBullet.svelte';
	import Note from '$lib/components/icons/Note.svelte';
	import GlobeAlt from '$lib/components/icons/GlobeAlt.svelte';
	import FileTypeIcon from './FileNav/FileTypeIcon.svelte';
	import type { WorkspaceOutputFile } from '$lib/stores';

	const i18n = getContext<Writable<i18nType>>('i18n');
	type WorkspaceArtifact = {
		type: 'canvas-note' | 'web-preview';
		title?: string;
		canvasId?: string;
		previewId?: string;
		noteId?: string;
	};

	export let onOpenFile: (file: WorkspaceOutputFile) => void = () => {};

	let show = false;
	let dropdown: Dropdown;

	$: artifacts = (
		Array.isArray($artifactContents) ? ($artifactContents as WorkspaceArtifact[]) : []
	).filter((item) => item?.type === 'canvas-note' || item?.type === 'web-preview');
	$: outputs = $workspaceOutputFiles;

	const close = () => dropdown?.close();

	function openArtifact(item: WorkspaceArtifact) {
		const id = item.canvasId || item.previewId || item.noteId;
		if (!id) return;
		workspaceOpenRequestId.set(id);
		showArtifacts.set(true);
		showControls.set(true);
		close();
	}

	function openFile(file: WorkspaceOutputFile) {
		onOpenFile(file);
		close();
	}
</script>

<Dropdown bind:this={dropdown} bind:show align="end" side="bottom" sideOffset={6}>
	<Tooltip content={$i18n.t('Outputs')}>
		<button
			type="button"
			class="flex size-6 cursor-pointer items-center justify-center rounded-lg text-gray-500 transition hover:bg-gray-50/40 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-800/40 dark:hover:text-gray-200"
			aria-label={$i18n.t('Outputs')}
			aria-expanded={show}
		>
			<ListBullet className="size-4" strokeWidth="1.5" />
		</button>
	</Tooltip>

	<div slot="content" class="w-[20rem] max-w-[calc(100vw-2rem)]">
		<DropdownMenu className="max-h-[min(32rem,calc(100dvh-4rem))] overflow-y-auto p-2!">
			<div class="px-2 pb-1 pt-0.5 text-xs font-medium text-gray-500 dark:text-gray-400">
				{$i18n.t('Outputs')}
			</div>

			{#if artifacts.length === 0 && outputs.length === 0}
				<div class="px-2 py-4 text-sm text-gray-500 dark:text-gray-400">
					{$i18n.t('No outputs yet')}
				</div>
			{:else}
				{#if artifacts.length > 0}
					{#each artifacts as item (item.canvasId || item.previewId || item.noteId)}
						<button type="button" on:click={() => openArtifact(item)}>
							{#if item.type === 'web-preview'}
								<GlobeAlt className="size-4" />
							{:else}
								<Note className="size-4" />
							{/if}
							<span class="min-w-0 flex-1 truncate text-left"
								>{item.title || $i18n.t('Untitled')}</span
							>
						</button>
					{/each}
				{/if}

				{#if outputs.length > 0}
					<div class="px-2 pb-1 pt-2 text-[11px] uppercase text-gray-400 dark:text-gray-500">
						{$i18n.t('Files')}
					</div>
					{#each outputs as file (`${file.source}:${file.terminalId ?? ''}:${file.path}`)}
						<button type="button" on:click={() => openFile(file)} title={file.path}>
							<FileTypeIcon name={file.name} type="file" size={16} />
							<span class="min-w-0 flex-1 truncate text-left">{file.name}</span>
						</button>
					{/each}
				{/if}
			{/if}
		</DropdownMenu>
	</div>
</Dropdown>
