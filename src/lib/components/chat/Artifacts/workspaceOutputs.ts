import { get, type Writable } from 'svelte/store';

import type { WorkspaceOutputFile } from '$lib/stores/artifactWorkspace';

export const WORKSPACE_OPEN_OUTPUT_EVENT = 'workspace:open-output';

const OUTPUT_EXTENSIONS = new Set([
	'csv',
	'doc',
	'docx',
	'ods',
	'odt',
	'pdf',
	'ppt',
	'pptx',
	'xls',
	'xlsx'
]);

export const isWorkspaceOutputPath = (path: unknown): path is string => {
	if (typeof path !== 'string' || !path.startsWith('/mnt/uploads/') || path.length > 1024)
		return false;
	if (/\p{Cc}/u.test(path)) return false;
	const parts = path.split('/');
	if (parts.includes('..') || parts.includes('.') || parts.slice(1).includes('')) return false;
	return OUTPUT_EXTENSIONS.has(path.split('.').pop()?.toLowerCase() ?? '');
};

export const createWorkspaceOutputFile = (
	path: unknown,
	options: Partial<WorkspaceOutputFile> = {}
): WorkspaceOutputFile | null => {
	if (!isWorkspaceOutputPath(path)) return null;
	return {
		path,
		name: path.split('/').filter(Boolean).at(-1) || 'Document',
		source: 'pyodide',
		page:
			Number.isSafeInteger(options.page) && Number(options.page) > 0 ? Number(options.page) : null,
		updatedAt: Math.max(0, Number(options.updatedAt) || Date.now())
	};
};

export const mergeWorkspaceOutputFiles = (
	current: WorkspaceOutputFile[],
	incoming: Array<WorkspaceOutputFile | null | undefined>
): WorkspaceOutputFile[] => {
	const byPath = new Map(current.map((item) => [item.path, item]));
	for (const item of incoming) {
		if (!item) continue;
		const previous = byPath.get(item.path);
		byPath.set(item.path, {
			...previous,
			...item,
			updatedAt: Math.max(previous?.updatedAt ?? 0, item.updatedAt)
		});
	}
	return [...byPath.values()]
		.sort((a, b) => b.updatedAt - a.updatedAt || a.name.localeCompare(b.name))
		.slice(0, 100);
};

export const normalizeWorkspaceOutputFiles = (value: unknown): WorkspaceOutputFile[] =>
	mergeWorkspaceOutputFiles(
		[],
		(Array.isArray(value) ? value : []).map((item) => createWorkspaceOutputFile(item?.path, item))
	);

export const isKnownWorkspaceOutputPath = (files: WorkspaceOutputFile[], path: unknown) =>
	typeof path === 'string' && files.some((file) => file.path === path);

export const resolveWorkspaceOutputFile = (
	files: WorkspaceOutputFile[],
	path: unknown
): WorkspaceOutputFile | null =>
	typeof path === 'string' ? (files.find((file) => file.path === path) ?? null) : null;

type PersistMutation = (
	chatId: string,
	mutation: { upsert?: WorkspaceOutputFile[]; remove?: string[] }
) => Promise<WorkspaceOutputFile[]>;

export const createWorkspaceOutputCatalog = (
	files: Writable<WorkspaceOutputFile[]>,
	persistMutation: PersistMutation,
	onError: (error: unknown) => void
) => {
	let activeChatId = '';
	let hydratedFiles: unknown;
	let persistenceQueue = Promise.resolve();

	const persist = (
		chatId: string,
		mutation: { upsert?: WorkspaceOutputFile[]; remove?: string[] }
	) => {
		persistenceQueue = persistenceQueue.then(async () => {
			try {
				const canonical = await persistMutation(chatId, mutation);
				if (activeChatId === chatId) files.set(normalizeWorkspaceOutputFiles(canonical));
			} catch (error) {
				console.error('Workspace output catalog could not be saved', error);
				onError(error);
			}
		});
	};

	const record = (chatId: string, path: unknown, options: { page?: number | null } = {}) => {
		const item = createWorkspaceOutputFile(path, options);
		if (!item || !chatId) return false;
		files.set(mergeWorkspaceOutputFiles(get(files), [item]));
		persist(chatId, { upsert: [item] });
		return true;
	};

	return {
		sync(chatId: string, persistedFiles: unknown) {
			if (activeChatId === chatId && hydratedFiles === persistedFiles) return;
			activeChatId = chatId;
			hydratedFiles = persistedFiles;
			files.set(chatId ? normalizeWorkspaceOutputFiles(persistedFiles) : []);
		},

		record,

		applyPyodideChange(chatId: string, detail: any) {
			if (!chatId || (detail?.chatId && detail.chatId !== chatId)) return;
			const paths: unknown[] = Array.isArray(detail?.paths) ? detail.paths : [];
			if (detail?.kind === 'deleted') {
				const deleted = paths.filter(isWorkspaceOutputPath);
				if (!deleted.length) return;
				const removed = new Set(deleted);
				files.set(get(files).filter((item) => !removed.has(item.path)));
				persist(chatId, { remove: deleted });
				return;
			}
			const upsert = paths
				.map((path: unknown) => createWorkspaceOutputFile(path))
				.filter((item: WorkspaceOutputFile | null): item is WorkspaceOutputFile => item !== null)
				.slice(0, 100);
			if (!upsert.length) return;
			files.set(mergeWorkspaceOutputFiles(get(files), upsert));
			persist(chatId, { upsert });
		}
	};
};
