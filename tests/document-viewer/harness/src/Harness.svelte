<script lang="ts">
	import { setContext } from 'svelte';
	import { writable } from 'svelte/store';
	import WorkspaceDocumentPanels from '$lib/components/chat/Artifacts/WorkspaceDocumentPanels.svelte';
	import WorkspaceTabs from '$lib/components/chat/Artifacts/WorkspaceTabs.svelte';
	import {
		buildWorkspaceFileContent,
		buildWorkspaceTabs,
		getWorkspaceContentId,
		getWorkspaceDocumentFormatForViewer,
		getWorkspaceFileOpenTarget,
		getWorkspaceFileId,
		limitWorkspaceFileContents,
		upsertWorkspaceFileContent,
		type WorkspaceContent,
		type WorkspaceTab
	} from '$lib/components/chat/Artifacts/workspace';
	import { terminalServers, workspaceActiveFile, workspaceFileUpdate } from '$lib/stores';

	const i18n = writable({ t: (message: string) => message });
	setContext('i18n', i18n);

	const format = new URLSearchParams(window.location.search).get('format') ?? 'pdf';
	const targetPage =
		Number(new URLSearchParams(window.location.search).get('targetPage')) || undefined;
	const runtimeSessionId =
		localStorage.getItem('viewer-runtime-session') ?? `viewer-browser-test-${crypto.randomUUID()}`;
	localStorage.setItem('viewer-runtime-session', runtimeSessionId);
	const unsupportedExtension = new URLSearchParams(window.location.search).get('unsupported');
	const documents: Record<string, { path: string; format: 'pdf' | 'docx' | 'pptx' }> = {
		pdf: { path: '/workspace/basic.pdf', format: 'pdf' },
		docx: { path: '/workspace/basic.docx', format: 'docx' },
		pptx: { path: '/workspace/basic.pptx', format: 'pptx' }
	};
	const document = documents[format];
	const workspacePanels = new URLSearchParams(window.location.search).has('workspace-panels');
	const workspaceLru = new URLSearchParams(window.location.search).has('workspace-lru');
	const unsupportedPath = unsupportedExtension ? `/workspace/example.${unsupportedExtension}` : '';
	const unsupportedFileOpenTarget = unsupportedPath
		? getWorkspaceFileOpenTarget(unsupportedPath)
		: null;
	const hasDedicatedDocument = Boolean(
		unsupportedPath ? getWorkspaceDocumentFormatForViewer(unsupportedPath, true) : document
	);
	let workspaceContents: WorkspaceContent[] = workspaceLru
		? []
		: workspacePanels
			? [
					buildWorkspaceFileContent(documents.pdf.path),
					buildWorkspaceFileContent(documents.docx.path)
				]
			: hasDedicatedDocument && document
				? [buildWorkspaceFileContent(document.path, targetPage)]
				: [];
	let selectedIndex = 0;
	let openedFileRecency: string[] = [];
	let evictedFileIds: string[] = [];
	$: selectedContent = workspaceContents[selectedIndex];
	$: selectedContentId = selectedContent
		? getWorkspaceContentId(selectedContent, selectedIndex)
		: '';
	$: workspaceTabs = buildWorkspaceTabs(workspaceContents);
	$: openFileIds = workspaceContents.map((content, index) => getWorkspaceContentId(content, index));
	$: workspaceActiveFile.set(
		selectedContent?.path && selectedContent.fileFormat
			? { path: selectedContent.path, format: selectedContent.fileFormat }
			: null
	);

	terminalServers.set([{ id: 'viewer-runtime', url: `${window.location.origin}/runtime` }]);
	workspaceActiveFile.set(document ?? null);
	localStorage.token = 'viewer-test-token';

	const refresh = () =>
		workspaceFileUpdate.set({
			path: selectedContent?.path ?? document?.path ?? '',
			kind: 'changed',
			revision: Date.now(),
			terminalId: 'viewer-runtime'
		});
	const remove = () =>
		workspaceFileUpdate.set({
			path: selectedContent?.path ?? document?.path ?? '',
			kind: 'deleted',
			revision: Date.now(),
			terminalId: 'viewer-runtime'
		});
	const selectWorkspaceTab = (tab: WorkspaceTab) => {
		selectedIndex = tab.index;
	};
	const closeWorkspaceTab = (tab: WorkspaceTab) => {
		workspaceContents = workspaceContents.filter((_, index) => index !== tab.index);
		selectedIndex = Math.min(selectedIndex, Math.max(0, workspaceContents.length - 1));
	};
	const openWorkspaceFile = (path: string) => {
		const id = getWorkspaceFileId(path);
		const nextContents = upsertWorkspaceFileContent(workspaceContents, path);
		const limited = limitWorkspaceFileContents(
			nextContents,
			[...openedFileRecency.filter((candidate) => candidate !== id), id],
			selectedContentId,
			4
		);
		workspaceContents = limited.contents;
		openedFileRecency = limited.recency;
		evictedFileIds = [...evictedFileIds, ...limited.evictedIds];
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
	{#if unsupportedPath || workspacePanels}
		<div
			class="files-state"
			data-testid="files-fallback-state"
			data-file-open-target={unsupportedFileOpenTarget ?? undefined}
		>
			{#if unsupportedPath}
				Files keeps {unsupportedPath.split('/').at(-1)} in its existing preview or download path.
			{:else}
				Files keeps unsupported formats in its existing preview; supported files open this tab
				panel.
			{/if}
		</div>
	{/if}
	{#if workspaceLru}
		<div class="lru-controls" aria-label="Workspace document sequence">
			{#each Array(10) as _, index}
				<button
					type="button"
					on:click={() => openWorkspaceFile(`/workspace/sequence-${index + 1}.pdf`)}
				>
					Open sequence-{index + 1}.pdf
				</button>
			{/each}
		</div>
		<output data-testid="lru-open-file-ids">{openFileIds.join(',')}</output>
		<output data-testid="lru-active-file-id">{selectedContentId}</output>
		<output data-testid="lru-evicted-file-ids">{evictedFileIds.join(',')}</output>
	{/if}
	{#if workspacePanels || workspaceLru}
		<WorkspaceTabs
			tabs={workspaceTabs}
			bind:selectedIndex
			terminalId={null}
			filesAvailable={false}
			onSelect={selectWorkspaceTab}
			onCloseTab={closeWorkspaceTab}
		/>
	{/if}
	<div class="workspace">
		<WorkspaceDocumentPanels
			contents={workspaceContents}
			{selectedContentId}
			runtime={{
				kind: 'terminal',
				terminalId: 'viewer-runtime',
				files: true,
				writable: true,
				shell: true,
				ports: true
			}}
			chatId={runtimeSessionId}
		/>
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
	.files-state {
		padding: 0 12px 8px;
		font-size: 12px;
		color: #5f5f5f;
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
