<script lang="ts">
	import { getContext } from 'svelte';
	import type { Writable } from 'svelte/store';
	import type { i18n as i18nType } from 'i18next';
	import { toast } from 'svelte-sonner';

	import { selectTransientWebPreview } from '$lib/apis/chats';
	import GlobeAlt from '$lib/components/icons/GlobeAlt.svelte';
	import {
		artifactCode,
		artifactContents,
		chatId,
		showArtifacts,
		showControls,
		showEmbeds,
		workspaceOpenRequestId
	} from '$lib/stores';
	import type { WebPreviewArtifact } from '../Artifacts/webPreview';

	const i18n: Writable<i18nType> = getContext('i18n');
	export let artifact: WebPreviewArtifact;

	$: current = (($artifactContents ?? []) as any[]).find(
		(item) => item?.type === 'web-preview' && item.previewId === artifact.previewId
	) as WebPreviewArtifact | undefined;
	$: title = current?.title ?? artifact.title;

	const openPreview = async () => {
		if ($chatId && artifact.source === 'tool') {
			try {
				const document = await selectTransientWebPreview(
					localStorage.token,
					$chatId,
					artifact.previewId
				);
				(artifactContents as any).update((items: any[] | null) =>
					(items ?? []).map((item) =>
						item?.previewId === artifact.previewId
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
		(artifactCode as any).set(artifact.previewId);
		showEmbeds.set(false);
		showArtifacts.set(true);
		showControls.set(true);
	};
</script>

<button
	type="button"
	class="my-2 flex w-fit max-w-full items-center gap-2.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-left text-gray-800 transition hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-200 dark:hover:bg-gray-900"
	aria-label={`${$i18n.t('Open')}: ${title}`}
	on:click={openPreview}
>
	<span
		class="flex size-8 shrink-0 items-center justify-center rounded-md bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300"
	>
		<GlobeAlt className="size-4" />
	</span>
	<span class="min-w-0">
		<span class="block max-w-64 truncate text-sm font-medium">{title}</span>
		<span class="block text-xs text-gray-500 dark:text-gray-400">{$i18n.t('Web preview')}</span>
	</span>
	<span class="ml-1 shrink-0 text-xs font-medium text-gray-600 dark:text-gray-300">
		{$i18n.t('Open')}
	</span>
</button>
