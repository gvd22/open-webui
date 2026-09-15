const WORKSPACE_STATE_VERSION = 2;
const MAX_WORKSPACE_ID_CHARS = 2048;
const MAX_WORKSPACE_PATH_CHARS = 1024;
const MAX_FILE_ID_CHARS = 256;

export type PersistedWorkspaceFile = { path: string; fileId?: string };

const isBoundedText = (value: unknown, maximum: number): value is string =>
	typeof value === 'string' &&
	value.length > 0 &&
	value.length <= maximum &&
	!/\p{Cc}/u.test(value);

const normalizeIds = (value: unknown) =>
	Array.isArray(value)
		? [...new Set(value.filter((item) => isBoundedText(item, MAX_WORKSPACE_ID_CHARS)))].slice(
				0,
				100
			)
		: [];

const normalizeOpenedFile = (item: unknown): PersistedWorkspaceFile | null => {
	const path = typeof item === 'string' ? item : (item as { path?: unknown } | null)?.path;
	if (!isBoundedText(path, MAX_WORKSPACE_PATH_CHARS) || !path.startsWith('/') || path.endsWith('/'))
		return null;
	const fileId = typeof item === 'object' && item ? (item as { fileId?: unknown }).fileId : null;
	return {
		path,
		...(isBoundedText(fileId, MAX_FILE_ID_CHARS) ? { fileId } : {})
	};
};

export type PersistedWorkspaceState = {
	version: number;
	order: string[];
	closed: string[];
	filesOpened: boolean;
	openedFiles: PersistedWorkspaceFile[];
};

const workspaceStateKey = (chatId: string, version = WORKSPACE_STATE_VERSION) =>
	`open-webui.workspace.tabs.v${version}:${chatId}`;

export const readWorkspaceState = (
	chatId: string,
	storage: Storage = localStorage
): PersistedWorkspaceState | null => {
	if (!chatId) return null;

	try {
		const raw =
			storage.getItem(workspaceStateKey(chatId)) ?? storage.getItem(workspaceStateKey(chatId, 1));
		const value = JSON.parse(raw ?? 'null');
		if (!value || ![1, WORKSPACE_STATE_VERSION].includes(value.version)) return null;
		const openedFiles = Array.isArray(value.openedFiles)
			? value.openedFiles
					.flatMap((item: unknown) => {
						const file = normalizeOpenedFile(item);
						return file ? [file] : [];
					})
					.slice(-4)
			: [];

		return {
			version: WORKSPACE_STATE_VERSION,
			order: normalizeIds(value.order),
			closed: normalizeIds(value.closed),
			filesOpened: value.filesOpened === true,
			openedFiles
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
