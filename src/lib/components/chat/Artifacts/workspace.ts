import { normalizeDocumentTargetPage } from '$lib/utils/documentPreview';

export const WORKSPACE_FILES_ID = 'workspace:files';
export const getWorkspaceFileId = (path: string) => `workspace:file:${path}`;
export type WorkspaceDocumentFormat = 'pdf' | 'docx' | 'pptx' | 'xls' | 'xlsx' | 'csv';
export type WorkspaceFileContent = {
	type: 'workspace-file';
	workspaceId: string;
	title: string;
	content: string;
	path: string;
	fileId?: string;
	fileFormat?: WorkspaceDocumentFormat;
	targetPage?: number;
};
export type WorkspaceContent =
	| WorkspaceFileContent
	| {
			type: 'workspace-files';
			workspaceId: typeof WORKSPACE_FILES_ID;
			title: string;
			content: string;
	  };
export type WorkspaceTab = {
	id: string;
	index: number;
	title: string;
	kind: WorkspaceContent['type'];
	closable: boolean;
};

export const isWorkspaceOpenRequestForChat = (
	requestChatId: string | null | undefined,
	currentChatId: string | null | undefined
) => !requestChatId || requestChatId === currentChatId;

export const getWorkspaceDocumentFormat = (path: string): WorkspaceDocumentFormat | null => {
	const extension = path.split('.').pop()?.toLowerCase();
	return extension && ['pdf', 'docx', 'pptx', 'xls', 'xlsx', 'csv'].includes(extension)
		? (extension as WorkspaceDocumentFormat)
		: null;
};

export const buildWorkspaceFileContent = (
	path: string,
	targetPage?: unknown,
	fileId?: string | null
): WorkspaceFileContent => {
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

export const upsertWorkspaceFileContent = (
	contents: WorkspaceFileContent[],
	path: string,
	targetPage?: unknown,
	fileId?: string | null
): WorkspaceFileContent[] => {
	const next = buildWorkspaceFileContent(path, targetPage, fileId);
	const index = contents.findIndex((content) => content.workspaceId === next.workspaceId);
	if (index === -1) return [...contents, next];
	const existing = contents[index];
	if (existing.targetPage === next.targetPage && existing.fileId === next.fileId) return contents;
	return contents.map((content, i) => (i === index ? next : content));
};

export const getWorkspaceContentId = (content: WorkspaceContent, _index?: number) =>
	content.workspaceId;
export const buildWorkspaceTabs = (contents: WorkspaceContent[]): WorkspaceTab[] =>
	contents.map((content, index) => ({
		id: content.workspaceId,
		index,
		title: content.title,
		kind: content.type,
		closable: content.workspaceId !== WORKSPACE_FILES_ID
	}));

export const getWorkspaceFileRefreshAction = (
	changedPaths: string[] | undefined,
	path: string
): 'ignore' | 'refresh' => {
	if (changedPaths?.length && !changedPaths.includes(path)) return 'ignore';
	return 'refresh';
};

export type WorkspaceFileChange = {
	path?: string;
	previousPath?: string;
	kind?: 'changed' | 'deleted' | 'renamed' | 'unknown';
};

export const getWorkspaceFileUpdateAction = (
	update: WorkspaceFileChange | null,
	path: string
): 'ignore' | 'refresh' | 'deleted' | 'renamed' => {
	if (!update) return 'ignore';
	const refersToPath = update.path === path || update.previousPath === path;
	if (update.kind === 'deleted' && refersToPath) return 'deleted';
	if (update.kind === 'renamed' && update.previousPath === path) return 'renamed';
	if (update.kind !== 'unknown' && !refersToPath) return 'ignore';
	return 'refresh';
};
