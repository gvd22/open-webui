export type WorkspaceContent = {
	type: string;
	content: string;
	title?: string;
	workspaceId?: string;
	canvasId?: string;
	noteId?: string;
	previewId?: string;
	entrypoint?: string;
	files?: Record<string, { content: string; mime: string }>;
	exportedPath?: string;
	exportedRuntime?: string;
	titleEdited?: boolean;
	canUndoAiUpdate?: boolean;
	updatedAt?: number;
	source?: string;
	path?: string;
	terminalId?: string;
};

export type WorkspaceTab = {
	id: string;
	index: number;
	title: string;
	kind: string;
	closable: boolean;
};

export type WorkspaceRuntime =
	| {
			kind: 'terminal';
			terminalId: string;
			files: true;
			writable: true;
			shell: true;
			ports: true;
	  }
	| {
			kind: 'pyodide';
			terminalId: null;
			files: true;
			writable: true;
			shell: false;
			ports: false;
	  }
	| {
			kind: 'none';
			terminalId: null;
			files: false;
			writable: false;
			shell: false;
			ports: false;
	  };

export const resolveWorkspaceRuntime = (
	terminalServers: Array<{ id?: string }> | null | undefined,
	selectedTerminalId: string | null | undefined,
	pyodideEnabled: boolean
): WorkspaceRuntime => {
	const systemTerminals = (terminalServers ?? []).filter((terminal): terminal is { id: string } =>
		Boolean(terminal.id)
	);
	const terminal =
		systemTerminals.find((candidate) => candidate.id === selectedTerminalId) ?? systemTerminals[0];

	// A configured managed terminal is authoritative. Runtime failures are shown by
	// that surface and must not silently redirect work into a different filesystem.
	if (terminal) {
		return {
			kind: 'terminal',
			terminalId: terminal.id,
			files: true,
			writable: true,
			shell: true,
			ports: true
		};
	}

	if (pyodideEnabled) {
		return {
			kind: 'pyodide',
			terminalId: null,
			files: true,
			writable: true,
			shell: false,
			ports: false
		};
	}

	return {
		kind: 'none',
		terminalId: null,
		files: false,
		writable: false,
		shell: false,
		ports: false
	};
};

export const WORKSPACE_FILES_ID = 'workspace:files';
export const WORKSPACE_TERMINAL_ID = 'workspace:terminal';
export const WORKSPACE_BROWSER_ID = 'workspace:browser';
export const WORKSPACE_LAUNCHER_ID = 'workspace:launcher';
export const getWorkspaceFileId = (path: string) => `workspace:file:${path}`;
export const getWorkspaceInstanceId = (kind: 'terminal' | 'browser', id: string) =>
	`workspace:${kind}:${id}`;

export const getNextWorkspaceInstanceTitle = (kind: 'terminal' | 'browser', titles: string[]) => {
	const base = kind === 'terminal' ? 'Terminal' : 'Browser';
	const used = titles
		.map((title) => (title === base ? 1 : Number(title.match(new RegExp(`^${base} (\\d+)$`))?.[1])))
		.filter((value) => Number.isFinite(value));
	const ordinal = Math.max(0, ...used) + 1;
	return ordinal === 1 ? base : `${base} ${ordinal}`;
};

// Pointer actions run on mousedown so a Svelte rerender cannot swallow the click.
// Keyboard activation has no preceding mousedown and reports click detail 0.
export const isKeyboardActivationClick = (detail: number) => detail === 0;

export const shouldResetWorkspaceForChatChange = (previousId: string, nextId: string) =>
	Boolean(previousId && previousId !== nextId);

export const hasWorkspaceAddActions = (terminalId: string | null, filesAvailable: boolean) =>
	Boolean(terminalId || filesAvailable);

export const buildWorkspaceFileContent = (path: string): WorkspaceContent => ({
	type: 'workspace-file',
	workspaceId: getWorkspaceFileId(path),
	title: path.split('/').filter(Boolean).at(-1) || 'File',
	content: '',
	path
});

export const buildWorkspaceUtilityContents = ({
	showFiles,
	showTerminal,
	showBrowser = false
}: {
	showFiles: boolean;
	showTerminal: boolean;
	showBrowser?: boolean;
}): WorkspaceContent[] => [
	...(showFiles
		? [
				{
					type: 'workspace-files',
					workspaceId: WORKSPACE_FILES_ID,
					title: 'Files',
					content: ''
				}
			]
		: []),
	...(showTerminal
		? [
				{
					type: 'workspace-terminal',
					workspaceId: WORKSPACE_TERMINAL_ID,
					title: 'Terminal',
					content: ''
				}
			]
		: []),
	...(showBrowser
		? [
				{
					type: 'workspace-browser',
					workspaceId: WORKSPACE_BROWSER_ID,
					title: 'Browser',
					content: ''
				}
			]
		: [])
];

const fallbackTitle = (kind: string) => {
	if (kind === 'canvas-note') return 'Document';
	if (kind === 'web-preview') return 'Web Preview';
	if (kind.includes('jira')) return 'Jira';
	if (kind.includes('terminal')) return 'Terminal';
	if (kind.includes('browser')) return 'Browser';
	if (kind.includes('file')) return 'Files';
	return 'Preview';
};

export const replaceWorkspaceFileContent = (
	contents: WorkspaceContent[],
	path: string
): WorkspaceContent[] => {
	const id = getWorkspaceFileId(path);
	return contents.length === 1 && getWorkspaceContentId(contents[0], 0) === id
		? contents
		: [buildWorkspaceFileContent(path)];
};

export const getWorkspaceContentId = (content: WorkspaceContent, index: number) =>
	content.workspaceId ??
	content.previewId ??
	content.canvasId ??
	content.noteId ??
	`${content.type || 'workspace-item'}:${index}`;

export const buildWorkspaceTabs = (contents: WorkspaceContent[]): WorkspaceTab[] =>
	contents.map((content, index) => ({
		id: getWorkspaceContentId(content, index),
		index,
		title: content.title?.trim() || fallbackTitle(content.type),
		kind: content.type,
		closable: true
	}));

export const getVisibleWorkspaceContents = (
	contents: WorkspaceContent[],
	closedContentIds: Set<string>
) =>
	contents.filter((content, index) => !closedContentIds.has(getWorkspaceContentId(content, index)));

export const orderWorkspaceContents = (
	contents: WorkspaceContent[],
	orderedIds: string[]
): WorkspaceContent[] => {
	const positions = new Map(orderedIds.map((id, index) => [id, index]));
	return contents
		.map((content, index) => ({ content, index, id: getWorkspaceContentId(content, index) }))
		.sort((a, b) => {
			const aPosition = positions.get(a.id);
			const bPosition = positions.get(b.id);
			if (aPosition === undefined && bPosition === undefined) return a.index - b.index;
			if (aPosition === undefined) return 1;
			if (bPosition === undefined) return -1;
			return aPosition - bPosition;
		})
		.map(({ content }) => content);
};

export const moveWorkspaceContent = (
	contents: WorkspaceContent[],
	sourceId: string,
	targetId: string
): WorkspaceContent[] => {
	if (sourceId === targetId) return contents;
	const sourceIndex = contents.findIndex(
		(content, index) => getWorkspaceContentId(content, index) === sourceId
	);
	const targetIndex = contents.findIndex(
		(content, index) => getWorkspaceContentId(content, index) === targetId
	);
	if (sourceIndex === -1 || targetIndex === -1) return contents;

	const reordered = [...contents];
	const [source] = reordered.splice(sourceIndex, 1);
	reordered.splice(targetIndex, 0, source);
	return reordered;
};

// The tab strip is the stable Workspace navigation, including when only one renderer is open.
export const shouldShowWorkspaceTabs = (contents: WorkspaceContent[]) => contents.length > 0;
