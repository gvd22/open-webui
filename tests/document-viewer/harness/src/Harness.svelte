<script lang="ts">
	import { setContext } from 'svelte';
	import { writable } from 'svelte/store';
	import WorkspaceDocumentPanels from '$lib/components/chat/Artifacts/WorkspaceDocumentPanels.svelte';
	import WorkspaceTabs from '$lib/components/chat/Artifacts/WorkspaceTabs.svelte';
	import {
		buildWorkspaceFileContent,
		buildWorkspaceTabs,
		getWorkspaceContentId,
		getWorkspaceFileId,
		upsertWorkspaceFileContent,
		type WorkspaceFileContent,
		type WorkspaceTab
	} from '$lib/components/chat/Artifacts/workspace';

	const i18n = writable({ t: (message: string) => message });
	setContext('i18n', i18n);

	const format = new URLSearchParams(window.location.search).get('format') ?? 'pdf';
	const fileId = new URLSearchParams(window.location.search).get('fileId');
	const targetPage =
		Number(new URLSearchParams(window.location.search).get('targetPage')) || undefined;
	const runtimeSessionId =
		localStorage.getItem('viewer-runtime-session') ?? `viewer-browser-test-${crypto.randomUUID()}`;
	localStorage.setItem('viewer-runtime-session', runtimeSessionId);
	const unsupportedExtension = new URLSearchParams(window.location.search).get('unsupported');
	const documents: Record<
		string,
		{ path: string; format: 'pdf' | 'docx' | 'pptx' | 'csv' | 'xlsx' | 'xls' }
	> = {
		pdf: { path: '/mnt/uploads/basic.pdf', format: 'pdf' },
		docx: { path: '/mnt/uploads/basic.docx', format: 'docx' },
		pptx: { path: '/mnt/uploads/basic.pptx', format: 'pptx' },
		csv: { path: '/mnt/uploads/basic.csv', format: 'csv' },
		xlsx: { path: '/mnt/uploads/basic.xlsx', format: 'xlsx' },
		xls: { path: '/mnt/uploads/basic.xls', format: 'xls' }
	};
	const document = documents[format];
	const workspacePanels = new URLSearchParams(window.location.search).has('workspace-panels');
	const workspaceLru = new URLSearchParams(window.location.search).has('workspace-lru');
	const unsupportedPath = unsupportedExtension
		? `/mnt/uploads/example.${unsupportedExtension}`
		: '';
	let workspaceContents: WorkspaceFileContent[] = workspaceLru
		? []
		: workspacePanels
			? [
					buildWorkspaceFileContent(documents.pdf.path),
					buildWorkspaceFileContent(documents.docx.path)
				]
			: unsupportedPath
				? [buildWorkspaceFileContent(unsupportedPath)]
				: document
					? [buildWorkspaceFileContent(document.path, targetPage, fileId ?? undefined)]
					: [];
	let selectedIndex = 0;
	$: selectedContent = workspaceContents[selectedIndex];
	$: selectedContentId = selectedContent
		? getWorkspaceContentId(selectedContent, selectedIndex)
		: '';
	$: workspaceTabs = buildWorkspaceTabs(workspaceContents);
	$: openFileIds = workspaceContents.map((content, index) => getWorkspaceContentId(content, index));
	const notifyFileChange = (kind: 'changed' | 'deleted') =>
		window.dispatchEvent(
			new CustomEvent('pyodide:files', {
				detail: { paths: [selectedContent?.path ?? document?.path ?? ''], kind }
			})
		);
	const refresh = () => notifyFileChange('changed');
	const remove = () => notifyFileChange('deleted');
	const selectWorkspaceTab = (tab: WorkspaceTab) => {
		selectedIndex = tab.index;
	};
	const closeWorkspaceTab = (tab: WorkspaceTab) => {
		workspaceContents = workspaceContents.filter((_, index) => index !== tab.index);
		selectedIndex = Math.min(selectedIndex, Math.max(0, workspaceContents.length - 1));
	};
	const openWorkspaceFile = (path: string) => {
		const id = getWorkspaceFileId(path);
		workspaceContents = upsertWorkspaceFileContent(workspaceContents, path);
		selectedIndex = workspaceContents.findIndex(
			(content, index) => getWorkspaceContentId(content, index) === id
		);
	};
</script>

<main class:dark={new URLSearchParams(window.location.search).get('theme') === 'dark'}>
	<header>
		<strong>Viewer harness</strong>
		<button type="button" data-testid="refresh-viewer" on:click={refresh}>Refresh</button>
		<button type="button" data-testid="delete-viewer" on:click={remove}>Delete</button>
		{#if workspacePanels}
			<button
				type="button"
				data-testid="reopen-pdf"
				on:click={() => openWorkspaceFile(documents.pdf.path)}
			>
				Reopen basic.pdf
			</button>
		{/if}
	</header>
	{#if workspaceLru}
		<div class="lru-controls" aria-label="Workspace document sequence">
			{#each Array(10) as _, index}
				<button
					type="button"
					on:click={() => openWorkspaceFile(`/mnt/uploads/sequence-${index + 1}.pdf`)}
				>
					Open sequence-{index + 1}.pdf
				</button>
			{/each}
		</div>
		<output data-testid="lru-open-file-ids">{openFileIds.join(',')}</output>
		<output data-testid="lru-active-file-id">{selectedContentId}</output>
	{/if}
	{#if workspacePanels || workspaceLru || unsupportedPath}
		<WorkspaceTabs
			tabs={workspaceTabs}
			bind:selectedIndex
			onSelect={selectWorkspaceTab}
			onCloseTab={closeWorkspaceTab}
		/>
	{/if}
	<div class="workspace">
		<WorkspaceDocumentPanels contents={workspaceContents} {selectedContentId} />
	</div>
</main>

<style>
	:global(html, body, #app) {
		margin: 0;
		height: 100%;
		font-family: system-ui, sans-serif;
	}
	main {
		height: 100%;
		background: #f5f4f1;
		color: #202020;
	}
	main.dark {
		background: #171719;
		color: #f4f4f5;
	}
	header {
		height: 40px;
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0 12px;
	}
	button {
		font: inherit;
	}
	.lru-controls {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
		padding: 0 12px 8px;
	}
	.lru-controls button {
		border: 1px solid #bbb;
		border-radius: 4px;
		padding: 2px 6px;
	}
	output {
		display: block;
		padding: 0 12px 4px;
		font-size: 11px;
	}
	.workspace {
		position: relative;
		height: calc(100% - 40px);
		min-height: 0;
		overflow: hidden;
	}
</style>
