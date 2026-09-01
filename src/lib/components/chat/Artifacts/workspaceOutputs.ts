import type { WorkspaceOutputFile } from '$lib/stores';

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

const parseJSON = (value: unknown): unknown => {
	let parsed = value;
	while (typeof parsed === 'string') {
		try {
			parsed = JSON.parse(parsed);
		} catch {
			break;
		}
	}
	return parsed;
};

export const isWorkspaceOutputPath = (path: unknown): path is string => {
	if (typeof path !== 'string' || !path.startsWith('/') || path.length > 1024) return false;
	if (/\p{Cc}/u.test(path)) return false;
	return OUTPUT_EXTENSIONS.has(path.split('.').pop()?.toLowerCase() ?? '');
};

export const createWorkspaceOutputFile = (
	path: unknown,
	options: Partial<WorkspaceOutputFile> = {}
): WorkspaceOutputFile | null => {
	if (!isWorkspaceOutputPath(path)) return null;
	return {
		path,
		name: options.name || path.split('/').filter(Boolean).at(-1) || 'Document',
		source: options.source === 'terminal' ? 'terminal' : 'pyodide',
		terminalId: options.terminalId ?? null,
		page:
			Number.isSafeInteger(options.page) && Number(options.page) > 0 ? Number(options.page) : null,
		updatedAt: Number(options.updatedAt) || Date.now()
	};
};

const outputFileKey = (item: WorkspaceOutputFile) =>
	`${item.source}:${item.terminalId ?? ''}:${item.path}`;

export const mergeWorkspaceOutputFiles = (
	current: WorkspaceOutputFile[],
	incoming: Array<WorkspaceOutputFile | null | undefined>
): WorkspaceOutputFile[] => {
	const byPath = new Map(current.map((item) => [outputFileKey(item), item]));
	for (const item of incoming) {
		if (!item) continue;
		const key = outputFileKey(item);
		const previous = byPath.get(key);
		byPath.set(key, {
			...previous,
			...item,
			updatedAt: Math.max(previous?.updatedAt ?? 0, item.updatedAt)
		});
	}
	return [...byPath.values()]
		.sort((a, b) => b.updatedAt - a.updatedAt || a.name.localeCompare(b.name))
		.slice(0, 100);
};

const outputText = (item: any) => {
	if (typeof item?.output === 'string') return item.output;
	if (!Array.isArray(item?.output)) return '';
	return item.output.map((part: any) => String(part?.text ?? '')).join('');
};

export const getWorkspaceOutputFilesFromHistory = (history: any): WorkspaceOutputFile[] => {
	const collected: WorkspaceOutputFile[] = [];
	for (const message of Object.values(history?.messages ?? {}) as any[]) {
		for (const item of Array.isArray(message?.output) ? message.output : []) {
			for (const file of Array.isArray(item?.files) ? item.files : []) {
				if (file?.source !== 'open_terminal') continue;
				const path = file?.full_path || file?.path;
				const output = createWorkspaceOutputFile(path, {
					name: file?.name,
					source: 'terminal',
					terminalId: file?.terminal_id || file?.terminal_selector,
					page: file?.page,
					updatedAt: Number(message?.timestamp) || Number(message?.created_at) || 1
				});
				if (output) collected.push(output);
			}

			if (item?.type !== 'function_call_output') continue;
			const result = parseJSON(outputText(item)) as any;
			if (result?.type !== 'file' || result?.source !== 'open_terminal') continue;
			const output = createWorkspaceOutputFile(result.full_path || result.path, {
				name: result.name,
				source: 'terminal',
				terminalId: result.terminal_id || result.terminal_selector,
				page: result.page,
				updatedAt: Number(message?.timestamp) || Number(message?.created_at) || 1
			});
			if (output) collected.push(output);
		}
	}
	return mergeWorkspaceOutputFiles([], collected);
};

export const workspaceOutputStorageKey = (chatId: string) =>
	`open-webui.workspace.outputs.v1:${chatId}`;

export const readWorkspaceOutputFiles = (chatId: string): WorkspaceOutputFile[] => {
	if (!chatId || typeof localStorage === 'undefined') return [];
	try {
		const value = JSON.parse(localStorage.getItem(workspaceOutputStorageKey(chatId)) ?? '[]');
		if (!Array.isArray(value)) return [];
		return mergeWorkspaceOutputFiles(
			[],
			value.map((item) => createWorkspaceOutputFile(item?.path, item))
		);
	} catch {
		return [];
	}
};

export const writeWorkspaceOutputFiles = (chatId: string, files: WorkspaceOutputFile[]) => {
	if (!chatId || typeof localStorage === 'undefined') return;
	localStorage.setItem(workspaceOutputStorageKey(chatId), JSON.stringify(files.slice(0, 100)));
};
