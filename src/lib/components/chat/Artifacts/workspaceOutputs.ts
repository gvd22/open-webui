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
	const stringMetadata = Object.fromEntries(
		(['fileId', 'messageId', 'originChatId', 'contentType'] as const).flatMap((key) => {
			const value = options[key];
			return typeof value === 'string' &&
				value.length > 0 &&
				value.length <= 256 &&
				!/\p{Cc}/u.test(value)
				? [[key, value]]
				: [];
		})
	);
	return {
		path,
		name: path.split('/').filter(Boolean).at(-1) || 'Document',
		source: 'pyodide',
		...stringMetadata,
		...(Number.isSafeInteger(options.size) && Number(options.size) >= 0
			? { size: Number(options.size) }
			: {}),
		...(Number.isFinite(options.persistedAt) && Number(options.persistedAt) >= 0
			? { persistedAt: Number(options.persistedAt) }
			: {}),
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

export const createWorkspaceOutputOpenDetail = (file: {
	workspace_path?: unknown;
	id?: unknown;
	url?: unknown;
	content_type?: unknown;
	size?: unknown;
}) => {
	if (!isWorkspaceOutputPath(file?.workspace_path)) return null;
	const fileId =
		typeof file.id === 'string' && file.id
			? file.id
			: typeof file.url === 'string' && file.url
				? file.url
				: undefined;
	return {
		path: file.workspace_path,
		...(fileId ? { fileId } : {}),
		...(typeof file.content_type === 'string' ? { contentType: file.content_type } : {}),
		...(Number.isSafeInteger(file.size) && Number(file.size) >= 0
			? { size: Number(file.size) }
			: {})
	};
};

type WorkspaceOutputSnapshot = { path: string; data: ArrayBuffer };

const isArrayBuffer = (value: unknown): value is ArrayBuffer =>
	value !== null &&
	typeof value === 'object' &&
	Object.prototype.toString.call(value) === '[object ArrayBuffer]';

export const parseWorkspaceOutputSnapshots = (value: unknown) => ({
	// An array means the worker captured the execution-time state atomically. Missing
	// paths must fail instead of being read after a later execution has changed them.
	atomic: Array.isArray(value),
	files: new Map(
		(Array.isArray(value) ? value : []).flatMap((snapshot): [string, ArrayBuffer][] =>
			snapshot &&
			typeof snapshot === 'object' &&
			isWorkspaceOutputPath((snapshot as WorkspaceOutputSnapshot).path) &&
			isArrayBuffer((snapshot as WorkspaceOutputSnapshot).data)
				? [[(snapshot as WorkspaceOutputSnapshot).path, (snapshot as WorkspaceOutputSnapshot).data]]
				: []
		)
	)
});

export const reassignWorkspaceOutputMessageFiles = (
	messages: Record<string, unknown>,
	path: string,
	messageId: string | undefined,
	reference: Record<string, unknown>
): Record<string, unknown> => {
	let changed = false;
	const next = { ...messages };
	for (const [id, candidate] of Object.entries(messages)) {
		if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue;
		const message = candidate as Record<string, unknown>;
		const current = Array.isArray(message.files) ? message.files : [];
		const files = current.filter(
			(file) =>
				!file ||
				typeof file !== 'object' ||
				(file as { source?: unknown }).source !== 'workspace-output' ||
				(file as { workspace_path?: unknown }).workspace_path !== path
		);
		if (id === messageId) files.push(reference);
		if (files.length !== current.length || id === messageId) {
			next[id] = { ...message, files };
			changed = true;
		}
	}
	return changed ? next : messages;
};

type PersistMutation = (
	chatId: string,
	mutation: { upsert?: WorkspaceOutputFile[]; remove?: string[] }
) => Promise<WorkspaceOutputFile[]>;

type PersistCallbacks = {
	onConfirmed?: () => void;
	onFailed?: (error: unknown) => void;
};

type PyodideFileChange = {
	chatId?: string;
	kind?: string;
	paths?: unknown[];
};

export const createWorkspaceOutputCatalog = (
	files: Writable<WorkspaceOutputFile[]>,
	persistMutation: PersistMutation,
	onError: (error: unknown) => void
) => {
	let activeChatId = '';
	let hydratedFiles: unknown;
	const persistenceQueues = new Map<string, Promise<void>>();
	const persistenceVersions = new Map<string, number>();
	const optimisticFiles = new Map<string, WorkspaceOutputFile[]>();
	const confirmedFiles = new Map<string, WorkspaceOutputFile[]>();

	const persist = (
		chatId: string,
		mutation: { upsert?: WorkspaceOutputFile[]; remove?: string[] },
		callbacks: PersistCallbacks = {}
	) => {
		const version = (persistenceVersions.get(chatId) ?? 0) + 1;
		persistenceVersions.set(chatId, version);
		const previous = persistenceQueues.get(chatId) ?? Promise.resolve();
		const next = previous
			.then(async () => {
				try {
					const canonical = await persistMutation(chatId, mutation);
					const normalized = normalizeWorkspaceOutputFiles(canonical);
					confirmedFiles.set(chatId, normalized);
					if (persistenceVersions.get(chatId) === version) {
						optimisticFiles.set(chatId, normalized);
						hydratedFiles = canonical;
						if (activeChatId === chatId) files.set(normalized);
					}
				} catch (error) {
					console.error('Workspace output catalog could not be saved', error);
					if (persistenceVersions.get(chatId) === version) {
						const confirmed = confirmedFiles.get(chatId) ?? [];
						optimisticFiles.set(chatId, confirmed);
						if (activeChatId === chatId) files.set(confirmed);
					}
					try {
						callbacks.onFailed?.(error);
					} catch (callbackError) {
						console.error('Workspace output failure callback failed', callbackError);
					}
					try {
						onError(error);
					} catch (callbackError) {
						console.error('Workspace output error handler failed', callbackError);
					}
					return;
				}
				try {
					callbacks.onConfirmed?.();
				} catch (error) {
					console.error('Workspace output confirmation callback failed', error);
				}
			})
			.finally(() => {
				if (persistenceQueues.get(chatId) === next) {
					persistenceQueues.delete(chatId);
					persistenceVersions.delete(chatId);
				}
			});
		persistenceQueues.set(chatId, next);
	};

	const record = (
		chatId: string,
		path: unknown,
		options: Partial<WorkspaceOutputFile> = {},
		callbacks: PersistCallbacks = {}
	) => {
		const item = createWorkspaceOutputFile(path, options);
		if (!item || !chatId) return false;
		const current = activeChatId === chatId ? get(files) : (optimisticFiles.get(chatId) ?? []);
		const next = mergeWorkspaceOutputFiles(current, [item]);
		optimisticFiles.set(chatId, next);
		if (activeChatId === chatId) files.set(next);
		persist(chatId, { upsert: [item] }, callbacks);
		return true;
	};

	return {
		sync(chatId: string, persistedFiles: unknown) {
			if (activeChatId === chatId && hydratedFiles === persistedFiles) return;
			activeChatId = chatId;
			if (persistenceQueues.has(chatId)) {
				files.set(optimisticFiles.get(chatId) ?? normalizeWorkspaceOutputFiles(persistedFiles));
				return;
			}
			hydratedFiles = persistedFiles;
			const normalized = chatId ? normalizeWorkspaceOutputFiles(persistedFiles) : [];
			if (chatId) {
				optimisticFiles.set(chatId, normalized);
				confirmedFiles.set(chatId, normalized);
			}
			files.set(normalized);
		},

		record,

		applyPyodideChange(chatId: string, detail: PyodideFileChange) {
			if (!chatId || (detail?.chatId && detail.chatId !== chatId)) return;
			const isActiveChat = activeChatId === chatId;
			const paths: unknown[] = Array.isArray(detail?.paths) ? detail.paths : [];
			if (detail?.kind === 'deleted') {
				const deleted = paths.filter(isWorkspaceOutputPath);
				if (!deleted.length) return;
				const current = isActiveChat ? get(files) : (optimisticFiles.get(chatId) ?? []);
				const durable = new Set(current.filter((item) => item.fileId).map((item) => item.path));
				const transientDeleted = deleted.filter((path) => !durable.has(path));
				if (!transientDeleted.length) return;
				const removed = new Set(transientDeleted);
				const next = current.filter((item) => !removed.has(item.path));
				optimisticFiles.set(chatId, next);
				if (isActiveChat) files.set(next);
				persist(chatId, { remove: transientDeleted });
				return;
			}
			const upsert = paths
				.map((path: unknown) => createWorkspaceOutputFile(path))
				.filter((item: WorkspaceOutputFile | null): item is WorkspaceOutputFile => item !== null)
				.slice(0, 100);
			if (!upsert.length) return;
			const current = isActiveChat ? get(files) : (optimisticFiles.get(chatId) ?? []);
			const next = mergeWorkspaceOutputFiles(current, upsert);
			optimisticFiles.set(chatId, next);
			if (isActiveChat) files.set(next);
			persist(chatId, { upsert });
		}
	};
};
