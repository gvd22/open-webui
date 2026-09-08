import { writable, type Writable } from 'svelte/store';

export type WorkspaceFileUpdate = {
	/** A known changed path. Omit it when a command may have changed any workspace file. */
	path?: string;
	revision: number;
	/** The previous path for a rename. Consumers of the old path treat it as unavailable. */
	previousPath?: string;
	/** File lifecycle events are explicit so a stale preview is never presented as current. */
	kind?: 'changed' | 'deleted' | 'renamed' | 'unknown';
};

export type WorkspaceOutputFile = {
	path: string;
	name: string;
	source: 'pyodide';
	fileId?: string;
	messageId?: string;
	originChatId?: string;
	contentType?: string;
	size?: number;
	persistedAt?: number;
	page?: number | null;
	updatedAt: number;
};

export const workspaceFileUpdate: Writable<WorkspaceFileUpdate | null> = writable(null);
export const workspaceActiveFile: Writable<{ path: string; format: string } | null> =
	writable(null);
export const workspaceOpenFilePaths: Writable<string[]> = writable([]);
export const workspaceOutputFiles: Writable<WorkspaceOutputFile[]> = writable([]);
export const workspaceChatContextId: Writable<string> = writable('');
export const workspaceOpenRequestId: Writable<string | null> = writable(null);
