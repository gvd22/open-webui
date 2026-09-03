import { WORKSPACE_LAUNCHER_ID } from './workspace';

const WORKSPACE_STATE_VERSION = 1;

export type PersistedWorkspaceState = {
	version: number;
	order: string[];
	closed: string[];
	filesOpened: boolean;
	openedFiles: string[];
	utilities: Array<{
		id: string;
		kind: 'terminal' | 'browser';
		title: string;
		terminalId?: string;
	}>;
};

const workspaceStateKey = (chatId: string) =>
	`open-webui.workspace.tabs.v${WORKSPACE_STATE_VERSION}:${chatId}`;

export const readWorkspaceState = (
	chatId: string,
	storage: Storage = localStorage
): PersistedWorkspaceState | null => {
	if (!chatId) return null;

	try {
		const value = JSON.parse(storage.getItem(workspaceStateKey(chatId)) ?? 'null');
		if (!value || value.version !== WORKSPACE_STATE_VERSION) return null;

		return {
			version: WORKSPACE_STATE_VERSION,
			order: Array.isArray(value.order)
				? value.order.filter((item: unknown) => typeof item === 'string').slice(0, 100)
				: [],
			closed: Array.isArray(value.closed)
				? value.closed
						.filter((item: unknown) => typeof item === 'string' && item !== WORKSPACE_LAUNCHER_ID)
						.slice(0, 100)
				: [],
			filesOpened: Boolean(value.filesOpened),
			openedFiles: Array.isArray(value.openedFiles)
				? value.openedFiles.filter((item: unknown) => typeof item === 'string').slice(-4)
				: [],
			utilities: Array.isArray(value.utilities)
				? value.utilities
						.filter(
							(item: any) =>
								item &&
								typeof item.id === 'string' &&
								item.id !== WORKSPACE_LAUNCHER_ID &&
								['terminal', 'browser'].includes(item.kind) &&
								typeof item.title === 'string' &&
								(item.terminalId === undefined || typeof item.terminalId === 'string')
						)
						.slice(0, 30)
				: []
		};
	} catch (error) {
		console.warn('Unable to restore workspace tab state', error);
		return null;
	}
};

export const writeWorkspaceState = (
	chatId: string,
	state: Omit<PersistedWorkspaceState, 'version'>,
	storage: Storage = localStorage
): boolean => {
	if (!chatId) return false;

	try {
		storage.setItem(
			workspaceStateKey(chatId),
			JSON.stringify({ version: WORKSPACE_STATE_VERSION, ...state })
		);
		return true;
	} catch (error) {
		console.warn('Unable to persist workspace tab state', error);
		return false;
	}
};
