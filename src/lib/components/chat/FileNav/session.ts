import type { FileEntry, TerminalFileRoot } from '$lib/apis/terminal';
import { isSavedChatId } from '$lib/utils/chatId';

export type FileNavSessionState = {
	savedPath: string;
	fileRoot: TerminalFileRoot | null;
	expandedDirs: string[];
	treeContents: [string, FileEntry[]][];
};

const sessionStateByWorkspace = new Map<string, FileNavSessionState>();

export const getFileNavWorkspaceKey = (
	terminal: { id: string | null; url: string },
	chatId: string | null
) => (isSavedChatId(chatId) ? `${terminal.id ?? terminal.url}\u0000${chatId}` : null);

export const saveFileNavSessionState = (key: string, state: FileNavSessionState) => {
	sessionStateByWorkspace.set(key, state);
};

export const readFileNavSessionState = (key: string | null) =>
	key ? (sessionStateByWorkspace.get(key) ?? null) : null;
