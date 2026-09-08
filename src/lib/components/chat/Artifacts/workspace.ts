import { normalizeDocumentTargetPage } from '$lib/utils/documentPreview';

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
	fileId?: string;
	fileFormat?: WorkspaceDocumentFormat;
	targetPage?: number;
};

export type WorkspaceDocumentFormat = 'pdf' | 'docx' | 'pptx' | 'xls' | 'xlsx' | 'csv';

export type WorkspaceTab = {
	id: string;
	index: number;
	title: string;
	kind: string;
	closable: boolean;
};

export type WorkspaceModelFocus = {
	kind: 'canvas' | 'web_preview';
	id: string;
};

export const WORKSPACE_FILES_ID = 'workspace:files';
export const getWorkspaceFileId = (path: string) => `workspace:file:${path}`;

// Pointer actions run on mousedown so a Svelte rerender cannot swallow the click.
// Keyboard activation has no preceding mousedown and reports click detail 0.
export const isKeyboardActivationClick = (detail: number) => detail === 0;

export const shouldResetWorkspaceForChatChange = (previousId: string, nextId: string) =>
	Boolean(previousId && previousId !== nextId);

export const isWorkspaceOpenRequestForChat = (
	requestChatId: string | null | undefined,
	currentChatId: string | null | undefined
) => !requestChatId || requestChatId === currentChatId;

export const getDefaultWorkspaceContentId = () => WORKSPACE_FILES_ID;

export const getWorkspaceDocumentFormat = (path: string): WorkspaceDocumentFormat | null => {
	const extension = path.split('.').pop()?.toLowerCase();
	return extension && ['pdf', 'docx', 'pptx', 'xls', 'xlsx', 'csv'].includes(extension)
		? (extension as WorkspaceDocumentFormat)
		: null;
};

export const getWorkspaceDocumentFormatForViewer = (path: string, enabled: boolean) =>
	enabled ? getWorkspaceDocumentFormat(path) : null;

export const isWorkspaceDocumentPath = (path: string) => getWorkspaceDocumentFormat(path) !== null;

/**
 * Shared by Pyodide Files before it delegates to a workspace tab. Formats
 * outside the narrow viewer contract stay in Files.
 */
export const getWorkspaceFileOpenTarget = (path: string): 'document-viewer' | 'files' =>
	getWorkspaceDocumentFormat(path) ? 'document-viewer' : 'files';

export const buildWorkspaceFileContent = (
	path: string,
	targetPage?: unknown,
	fileId?: string | null
): WorkspaceContent => {
	const page = normalizeDocumentTargetPage(targetPage);
	return {
		type: 'workspace-file',
		workspaceId: getWorkspaceFileId(path),
		title: path.split('/').filter(Boolean).at(-1) || 'File',
		content: '',
		path,
		...(fileId ? { fileId } : {}),
		fileFormat: getWorkspaceDocumentFormat(path) ?? undefined,
		...(page ? { targetPage: page } : {})
	};
};

export const buildWorkspaceFilesContent = (): WorkspaceContent => ({
	type: 'workspace-files',
	workspaceId: WORKSPACE_FILES_ID,
	title: 'Files',
	content: ''
});

export const buildWorkspaceSourceContents = (
	showFiles: boolean,
	filesOpened: boolean,
	documentViewerEnabled: boolean,
	artifactContents: WorkspaceContent[],
	openedFileContents: WorkspaceContent[]
): WorkspaceContent[] => [
	...(showFiles && filesOpened ? [buildWorkspaceFilesContent()] : []),
	...artifactContents,
	...(documentViewerEnabled ? openedFileContents : [])
];

const fallbackTitle = (kind: string) => {
	if (kind === 'canvas-note') return 'Document';
	if (kind === 'web-preview') return 'Web Preview';
	if (kind.includes('jira')) return 'Jira';
	if (kind.includes('file')) return 'Files';
	return 'Preview';
};

export const upsertWorkspaceFileContent = (
	contents: WorkspaceContent[],
	path: string,
	targetPage?: unknown,
	fileId?: string | null
): WorkspaceContent[] => {
	const id = getWorkspaceFileId(path);
	const page = normalizeDocumentTargetPage(targetPage);
	const existing = contents.find((content, index) => getWorkspaceContentId(content, index) === id);
	if (!existing) return [...contents, buildWorkspaceFileContent(path, page, fileId)];
	if ((existing.targetPage ?? null) === page && (existing.fileId ?? null) === (fileId ?? null)) {
		return contents;
	}
	return contents.map((content, index) =>
		getWorkspaceContentId(content, index) === id
			? {
					...content,
					...(page ? { targetPage: page } : { targetPage: undefined }),
					...(fileId ? { fileId } : { fileId: undefined })
				}
			: content
	);
};

export const limitWorkspaceFileContents = (
	contents: WorkspaceContent[],
	recency: string[],
	activeId: string,
	maximum: number
) => {
	const ids = contents.map((content, index) => getWorkspaceContentId(content, index));
	const contentIds = new Set(ids);
	const orderedIds = [
		...new Set(recency.filter((id) => contentIds.has(id))),
		...ids.filter((id) => !recency.includes(id))
	];
	const remainingIds = new Set(ids);
	const evictedIds: string[] = [];

	for (const id of orderedIds) {
		if (remainingIds.size <= Math.max(1, maximum)) break;
		if (id !== activeId) {
			remainingIds.delete(id);
			evictedIds.push(id);
		}
	}

	return {
		contents: contents.filter((content, index) =>
			remainingIds.has(getWorkspaceContentId(content, index))
		),
		recency: orderedIds.filter((id) => remainingIds.has(id)),
		evictedIds
	};
};

export const getWorkspaceFileRefreshAction = (
	changedPaths: string[] | undefined,
	path: string,
	isActive: boolean
): 'ignore' | 'refresh' | 'defer' => {
	if (changedPaths?.length && !changedPaths.includes(path)) return 'ignore';
	return isActive ? 'refresh' : 'defer';
};

export type WorkspaceFileChange = {
	path?: string;
	previousPath?: string;
	kind?: 'changed' | 'deleted' | 'renamed' | 'unknown';
};

export const getWorkspaceFileUpdateAction = (
	update: WorkspaceFileChange | null,
	path: string,
	isActive: boolean
): 'ignore' | 'refresh' | 'defer' | 'deleted' | 'renamed' => {
	if (!update) return 'ignore';
	const refersToPath = update.path === path || update.previousPath === path;
	if (update.kind === 'deleted' && refersToPath) return 'deleted';
	if (update.kind === 'renamed' && update.previousPath === path) return 'renamed';
	if (update.kind !== 'unknown' && !refersToPath) return 'ignore';
	return isActive ? 'refresh' : 'defer';
};

const fallbackWorkspaceIds = new WeakMap<WorkspaceContent, string>();

const hashWorkspaceIdentity = (value: string) => {
	let hash = 0x811c9dc5;
	for (let index = 0; index < value.length; index += 1) {
		hash ^= value.charCodeAt(index);
		hash = Math.imul(hash, 0x01000193);
	}
	return (hash >>> 0).toString(36);
};

export const getWorkspaceContentId = (content: WorkspaceContent, _index: number) => {
	const explicitId = content.workspaceId ?? content.previewId ?? content.canvasId ?? content.noteId;
	if (explicitId) return explicitId;

	const cachedId = fallbackWorkspaceIds.get(content);
	if (cachedId) return cachedId;

	const type = content.type || 'workspace-item';
	const identity = [type, content.source ?? '', content.content].join('\u0000');
	const id = `${type}:${hashWorkspaceIdentity(identity)}`;
	fallbackWorkspaceIds.set(content, id);
	return id;
};

export const getWorkspaceModelFocus = (
	contents: WorkspaceContent[] | null | undefined,
	selectedId: string | null | undefined,
	visible: boolean
): WorkspaceModelFocus | undefined => {
	if (!visible || !selectedId) return undefined;
	const selected = (contents ?? []).find(
		(content, index) => getWorkspaceContentId(content, index) === selectedId
	);
	if (selected?.type === 'canvas-note' && selected.canvasId) {
		return { kind: 'canvas', id: selected.canvasId };
	}
	if (selected?.type === 'web-preview' && selected.previewId) {
		return { kind: 'web_preview', id: selected.previewId };
	}
	return undefined;
};

export const buildWorkspaceTabs = (contents: WorkspaceContent[]): WorkspaceTab[] =>
	contents.map((content, index) => ({
		id: getWorkspaceContentId(content, index),
		index,
		title: content.title?.trim() || fallbackTitle(content.type),
		kind: content.type,
		closable: getWorkspaceContentId(content, index) !== WORKSPACE_FILES_ID
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
