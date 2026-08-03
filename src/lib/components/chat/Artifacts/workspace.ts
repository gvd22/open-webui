export type WorkspaceContent = {
	type: string;
	content: string;
	title?: string;
	workspaceId?: string;
	canvasId?: string;
	noteId?: string;
	titleEdited?: boolean;
	canUndoAiUpdate?: boolean;
	updatedAt?: number;
	source?: string;
};

export type WorkspaceTab = {
	id: string;
	index: number;
	title: string;
	kind: string;
};

const fallbackTitle = (kind: string) => {
	if (kind === 'canvas-note') return 'Document';
	if (kind.includes('jira')) return 'Jira';
	if (kind.includes('terminal')) return 'Terminal';
	if (kind.includes('file')) return 'Files';
	return 'Preview';
};

export const getWorkspaceContentId = (content: WorkspaceContent, index: number) =>
	content.workspaceId ??
	content.canvasId ??
	content.noteId ??
	`${content.type || 'workspace-item'}:${index}`;

export const buildWorkspaceTabs = (contents: WorkspaceContent[]): WorkspaceTab[] =>
	contents.map((content, index) => ({
		id: getWorkspaceContentId(content, index),
		index,
		title: content.title?.trim() || fallbackTitle(content.type),
		kind: content.type
	}));

export const getVisibleWorkspaceContents = (
	contents: WorkspaceContent[],
	closedContentIds: Set<string>
) =>
	contents.filter((content, index) => !closedContentIds.has(getWorkspaceContentId(content, index)));

// The tab strip is the stable Workspace navigation, including when only one renderer is open.
export const shouldShowWorkspaceTabs = (contents: WorkspaceContent[]) => contents.length > 0;
