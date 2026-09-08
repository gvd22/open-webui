export const PYODIDE_WORKSPACE_ROOT = '/mnt/uploads';
export const PYODIDE_WORKSPACE_DIRECTORY = `${PYODIDE_WORKSPACE_ROOT}/`;

const normalizeAbsolutePath = (path: string) => {
	const parts: string[] = [];
	for (const part of path.split('/')) {
		if (!part || part === '.') continue;
		if (part === '..') parts.pop();
		else parts.push(part);
	}
	return `/${parts.join('/')}`;
};

export const getPyodideWorkspacePath = (path: string): string | null => {
	if (!path.startsWith('/') || path.includes('\0')) return null;
	const normalized = normalizeAbsolutePath(path);
	return normalized === PYODIDE_WORKSPACE_ROOT ||
		normalized.startsWith(`${PYODIDE_WORKSPACE_ROOT}/`)
		? normalized
		: null;
};

export const requirePyodideWorkspacePath = (path: string) => {
	const normalized = getPyodideWorkspacePath(path);
	if (!normalized) throw new Error('Path is outside the Pyodide workspace');
	return normalized;
};

export const isValidPyodideEntryName = (name: string) =>
	name.length > 0 &&
	name.length <= 255 &&
	name !== '.' &&
	name !== '..' &&
	!name.includes('/') &&
	!name.includes('\\') &&
	!/[\u0000-\u001f\u007f]/.test(name);

export const getWorkspaceFileChanges = (
	before: Map<string, string>,
	after: Map<string, string>
) => ({
	changed: [...after].flatMap(([path, signature]) =>
		before.get(path) === signature ? [] : [path]
	),
	deleted: [...before.keys()].filter((path) => !after.has(path))
});

export const asPyodideWorkspaceDirectory = (path: string) =>
	`${getPyodideWorkspacePath(path) ?? PYODIDE_WORKSPACE_ROOT}/`;

export const getPyodideWorkspaceBreadcrumbs = (path: string) => {
	const normalized = getPyodideWorkspacePath(path) ?? PYODIDE_WORKSPACE_ROOT;
	const relativeParts = normalized.slice(PYODIDE_WORKSPACE_ROOT.length).split('/').filter(Boolean);
	return relativeParts.reduce(
		(acc, part) => {
			const previous = acc[acc.length - 1];
			acc.push({ label: part, path: `${previous.path}${part}/` });
			return acc;
		},
		[{ label: 'Home', path: PYODIDE_WORKSPACE_DIRECTORY }]
	);
};
