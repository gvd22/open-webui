<script lang="ts">
	import { getContext } from 'svelte';
	import type { Writable } from 'svelte/store';
	import type { i18n as i18nType } from 'i18next';

	import { toast } from 'svelte-sonner';
	import CheckCircle from '$lib/components/icons/CheckCircle.svelte';
	import XMark from '$lib/components/icons/XMark.svelte';
	import Spinner from '$lib/components/common/Spinner.svelte';
	import { generateCanvasTitle, type CanvasNoteArtifact } from '../Artifacts/canvas';
	import { openCanvasArtifact } from './workspaceArtifactOpen';

	const i18n: Writable<i18nType> = getContext('i18n');
	export let name = '';
	export let done = false;
	export let artifact: CanvasNoteArtifact | undefined = undefined;
	export let error = '';

	const toolLabels: Record<string, { pending: string; complete: string }> = {
		canvas_create_document: {
			pending: 'Creating canvas',
			complete: 'Canvas created'
		},
		canvas_update_document: {
			pending: 'Updating canvas',
			complete: 'Canvas updated'
		},
		canvas_select_document: {
			pending: 'Opening canvas',
			complete: 'Canvas opened'
		},
		canvas_list_documents: {
			pending: 'Checking canvas documents',
			complete: 'Canvas documents checked'
		},
		canvas_read_document: {
			pending: 'Reading canvas',
			complete: 'Canvas read'
		},
		canvas_replace_text: {
			pending: 'Updating canvas',
			complete: 'Canvas updated'
		}
	};
	const errorLabels: Record<string, string> = {
		canvas_create_document: 'Canvas could not be created',
		canvas_update_document: 'Canvas could not be updated',
		canvas_select_document: 'Canvas could not be opened',
		canvas_list_documents: 'Canvas documents could not be checked',
		canvas_read_document: 'Canvas could not be read',
		canvas_replace_text: 'Canvas could not be updated'
	};

	$: label = toolLabels[name] ?? toolLabels.canvas_update_document;
	$: errorLabel = errorLabels[name] ?? errorLabels.canvas_update_document;
	$: title = artifact ? generateCanvasTitle(artifact.content, artifact.title) : '';

	const openCanvas = () =>
		artifact &&
		openCanvasArtifact(artifact, () => toast.error($i18n.t('Document could not be opened')));
</script>

{#if artifact && done && !error}
	<button
		type="button"
		class="block max-w-full w-fit py-1 text-left text-[0.9375rem] text-gray-500 transition hover:text-gray-700 dark:hover:text-gray-300"
		aria-label={`${$i18n.t(label.complete)}: ${title}`}
		on:click={openCanvas}
	>
		<span class="flex w-full max-w-full items-center gap-1.5 font-normal">
			<span class="text-emerald-500 dark:text-emerald-400">
				<CheckCircle className="size-4" strokeWidth="2" />
			</span>
			<span class="max-w-72 flex-1 truncate text-black dark:text-white"
				>{$i18n.t(label.complete)}: {title}</span
			>
		</span>
	</button>
{:else}
	<div
		class="w-fit py-1 text-[0.9375rem] text-gray-500 dark:text-gray-400"
		role={error ? 'alert' : 'status'}
		aria-live="polite"
	>
		<span class="flex w-full max-w-full items-center gap-1.5 font-normal {error ? '' : 'shimmer'}">
			{#if error}
				<span class="text-red-600 dark:text-red-400">
					<XMark className="size-4" strokeWidth="2" />
				</span>
			{:else if done}
				<span class="text-emerald-500 dark:text-emerald-400">
					<CheckCircle className="size-4" strokeWidth="2" />
				</span>
			{:else}
				<span><Spinner className="size-4" /></span>
			{/if}
			<span
				class="max-w-72 flex-1 truncate {error
					? 'text-red-700 dark:text-red-300'
					: 'text-black dark:text-white'}"
			>
				{$i18n.t(error ? errorLabel : done ? label.complete : label.pending)}{title
					? `: ${title}`
					: ''}
			</span>
		</span>
	</div>
{/if}
