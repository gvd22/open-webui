<script lang="ts">
	import { getContext } from 'svelte';
	import type { Writable } from 'svelte/store';
	import type { i18n as i18nType } from 'i18next';

	import ChevronRight from '$lib/components/icons/ChevronRight.svelte';
	import Icon from '$lib/components/chat/FileNav/Icon.svelte';
	import { fileIconName } from '$lib/components/chat/FileNav/fileIcon';
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
	$: extension = name.split('.').pop()?.toLowerCase() ?? '';
	$: presentation = ['doc', 'docx', 'odt'].includes(extension)
		? { label: $i18n.t('Word document'), tone: 'text-blue-600 dark:text-blue-400' }
		: ['ppt', 'pptx'].includes(extension)
			? { label: $i18n.t('PowerPoint presentation'), tone: 'text-orange-600 dark:text-orange-400' }
			: ['xls', 'xlsx', 'ods', 'csv'].includes(extension)
				? { label: $i18n.t('Spreadsheet'), tone: 'text-emerald-600 dark:text-emerald-400' }
				: extension === 'pdf'
					? { label: $i18n.t('PDF document'), tone: 'text-red-600 dark:text-red-400' }
					: { label: $i18n.t('Document'), tone: 'text-gray-600 dark:text-gray-300' };

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
	class="my-2 flex w-fit max-w-full items-center gap-2.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-left text-gray-800 transition hover:bg-gray-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-400 disabled:cursor-default disabled:opacity-60 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-200 dark:hover:bg-gray-900"
	aria-label={`${$i18n.t('Open')}: ${name}`}
	disabled={!file?.workspace_path}
	on:click={open}
>
	<span
		class="flex size-8 shrink-0 items-center justify-center rounded-md bg-gray-100 dark:bg-gray-800 {presentation.tone}"
	>
		<Icon name={fileIconName(name)} size={17} strokeWidth={1.6} />
	</span>
	<span class="min-w-0">
		<span class="block max-w-64 truncate text-sm font-medium">{name}</span>
		<span class="block text-xs text-gray-500 dark:text-gray-400">
			{presentation.label}{file?.size != null ? ` · ${formatFileSize(file.size)}` : ''}
		</span>
	</span>
	<span
		class="ml-1 flex shrink-0 items-center gap-1 text-xs font-medium text-gray-600 dark:text-gray-300"
	>
		{$i18n.t('Open')}
		<ChevronRight className="size-3.5" strokeWidth="1.8" />
	</span>
</button>
