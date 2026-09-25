<script lang="ts">
	import { getContext } from 'svelte';
	import type { Writable } from 'svelte/store';
	import type { i18n as i18nType } from 'i18next';

	import Icon from '$lib/components/chat/FileNav/Icon.svelte';
	import { fileIconName, fileIconTone } from '$lib/components/chat/FileNav/fileIcon';
	import { formatFileSize } from '$lib/utils';
	import {
		createWorkspaceOutputOpenDetail,
		WORKSPACE_OPEN_OUTPUT_EVENT
	} from '$lib/components/chat/Artifacts/workspaceOutputs';

	const i18n = getContext<Writable<i18nType>>('i18n');

	export let file: {
		id?: string;
		url?: string;
		name?: string;
		size?: number;
		content_type?: string;
		workspace_path?: string;
	};

	$: name = file?.name || file?.workspace_path?.split('/').at(-1) || $i18n.t('Document');

	const open = () => {
		const detail = createWorkspaceOutputOpenDetail(file);
		if (!detail) return;
		window.dispatchEvent(
			new CustomEvent(WORKSPACE_OPEN_OUTPUT_EVENT, {
				detail
			})
		);
	};
</script>

<button
	type="button"
	class="group flex h-9 w-full min-w-0 items-center gap-2 rounded-md border border-gray-200 bg-gray-50/60 px-2.5 text-left text-gray-800 transition hover:bg-gray-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-400 disabled:cursor-default disabled:opacity-60 dark:border-gray-700/70 dark:bg-gray-800/40 dark:text-gray-200 dark:hover:bg-gray-800"
	aria-label={`${$i18n.t('Open')}: ${name}`}
	title={`${name}${file?.size != null ? ` · ${formatFileSize(file.size)}` : ''}`}
	data-testid="workspace-output-chip"
	disabled={!file?.workspace_path}
	on:click={open}
>
	<span class="shrink-0 {fileIconTone(name)}">
		<Icon name={fileIconName(name)} size={16} strokeWidth={1.6} />
	</span>
	<span class="min-w-0 truncate text-xs">{name}</span>
</button>
