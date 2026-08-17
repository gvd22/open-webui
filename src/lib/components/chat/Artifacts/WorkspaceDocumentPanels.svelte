<script lang="ts">
	import DocumentFileViewer from './DocumentViewer/DocumentFileViewer.svelte';
	import { getWorkspaceContentId, type WorkspaceContent, type WorkspaceRuntime } from './workspace';

	export let contents: WorkspaceContent[] = [];
	export let selectedContentId = '';
	export let runtime: WorkspaceRuntime;
	export let chatId: string | null = null;
</script>

{#each contents as content, index (getWorkspaceContentId(content, index))}
	{#if content.type === 'workspace-file' && content.path && content.fileFormat}
		<div
			id={`workspace-panel-${index}`}
			role="tabpanel"
			aria-labelledby={`workspace-tab-${index}`}
			hidden={selectedContentId !== getWorkspaceContentId(content, index)}
			class="absolute inset-0"
		>
			{#if selectedContentId === getWorkspaceContentId(content, index)}
				<DocumentFileViewer path={content.path} format={content.fileFormat} {runtime} {chatId} />
			{/if}
		</div>
	{/if}
{/each}
