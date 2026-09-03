import { writable, type Writable } from 'svelte/store';

export type WorkspaceFileUpdate = {
	/** A known changed path. Omit it when a command may have changed any workspace file. */
	path?: string;
	revision: number;
	/** The previous path for a rename. Consumers of the old path treat it as unavailable. */
	previousPath?: string;
	/** File lifecycle events are explicit so a stale preview is never presented as current. */
	kind?: 'changed' | 'deleted' | 'renamed' | 'unknown';
	/** Limits invalidation to one managed terminal when that identity is known. */
	terminalId?: string | null;
};

export type WorkspaceOutputFile = {
	path: string;
	name: string;
	source: 'terminal' | 'pyodide';
	terminalId?: string | null;
	page?: number | null;
	updatedAt: number;
};

export type WorkspaceUtilityInstance = {
	id: string;
	kind: 'terminal' | 'browser';
	title: string;
	terminalId?: string;
};

export const workspaceFileUpdate: Writable<WorkspaceFileUpdate | null> = writable(null);
export const workspaceActiveFile: Writable<{ path: string; format: string } | null> =
	writable(null);
export const workspaceOpenFilePaths: Writable<string[]> = writable([]);
export const workspaceOutputFiles: Writable<WorkspaceOutputFile[]> = writable([]);
export const workspaceTerminalConnectionId: Writable<string | null> = writable(null);
export const workspaceChatContextId: Writable<string> = writable('');
export const workspaceOpenRequestId: Writable<string | null> = writable(null);
export const workspaceUtilityInstances: Writable<WorkspaceUtilityInstance[]> = writable([]);
