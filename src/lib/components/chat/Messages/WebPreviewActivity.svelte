<script lang="ts">
	import { getContext } from 'svelte';
	import type { Writable } from 'svelte/store';
	import type { i18n as i18nType } from 'i18next';
	import { toast } from 'svelte-sonner';

	import { selectTransientWebPreview } from '$lib/apis/chats';
	import {
		artifactCode,
		artifactContents,
		chatId,
		showArtifacts,
		showControls,
		showEmbeds,
		workspaceOpenRequestId
	} from '$lib/stores';
	import CheckCircle from '$lib/components/icons/CheckCircle.svelte';
	import XMark from '$lib/components/icons/XMark.svelte';
	import Spinner from '$lib/components/common/Spinner.svelte';
	import type { WebPreviewArtifact } from '../Artifacts/webPreview';

	export let name = '';
	export let done = false;
	export let artifact: WebPreviewArtifact | undefined = undefined;
	export let error = '';
	const i18n: Writable<i18nType> = getContext('i18n');

	const labels: Record<string, [string, string]> = {
		web_preview_create: ['Creating web preview', 'Web preview created'],
		web_preview_update: ['Updating web preview', 'Web preview updated'],
		web_preview_select: ['Opening web preview', 'Web preview opened'],
		web_preview_list: ['Checking web previews', 'Web previews checked'],
		web_preview_read_file: ['Reading web preview', 'Web preview read'],
		web_preview_replace_text: ['Updating web preview', 'Web preview updated'],
		web_preview_import_runtime_file: ['Importing preview data', 'Preview data imported']
	};
	$: label = labels[name] ?? labels.web_preview_update;

	const openPreview = async () => {
		if (!artifact) return;
		if ($chatId && artifact.source === 'tool') {
			try {
				const document = await selectTransientWebPreview(
					localStorage.token,
					$chatId,
					artifact.previewId
				);
				(artifactContents as any).update((items: any[] | null) =>
					(items ?? []).map((item) =>
						item?.previewId === artifact?.previewId
							? {
									...item,
									title: document.title,
									entrypoint: document.entrypoint,
									files: document.files,
									content: document.files?.[document.entrypoint]?.content ?? '',
									updatedAt: document.updated_at,
									contentHash: document.contentHash
								}
							: item
					)
				);
			} catch {
				toast.error($i18n.t('Preview could not be refreshed'));
				return;
			}
		}
		workspaceOpenRequestId.set(artifact.previewId);
		artifactCode.set(artifact.previewId as any);
		showEmbeds.set(false);
		if (!$showArtifacts) showArtifacts.set(true);
		if (!$showControls) showControls.set(true);
	};
</script>

{#if artifact && done && !error}
	<button
		type="button"
		class="w-fit py-1 text-left text-[0.9375rem] text-gray-500 transition hover:text-gray-700 dark:hover:text-gray-300"
		aria-label={`${$i18n.t(label[1])}: ${artifact.title}`}
		on:click={openPreview}
	>
		<span class="flex w-full max-w-full items-center gap-1.5 font-normal">
			<span class="text-emerald-500 dark:text-emerald-400">
				<CheckCircle className="size-4" strokeWidth="2" />
			</span>
			<span class="max-w-72 flex-1 truncate text-black dark:text-white">
				{$i18n.t(label[1])}: {artifact.title}
			</span>
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
					<XMark className="size-4" />
				</span>
			{:else if done}
				<span class="text-emerald-500 dark:text-emerald-400">
					<CheckCircle className="size-4" strokeWidth="2" />
				</span>
			{:else}
				<Spinner className="size-4" />
			{/if}
			<span
				class="max-w-72 flex-1 truncate {error
					? 'text-red-700 dark:text-red-300'
					: 'text-black dark:text-white'}"
			>
				{error || $i18n.t(done ? label[1] : label[0])}{artifact?.title ? `: ${artifact.title}` : ''}
			</span>
		</span>
	</div>
{/if}
