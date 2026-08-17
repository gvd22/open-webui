import { describe, expect, it } from 'vitest';

import {
	asPyodideWorkspaceDirectory,
	getPyodideWorkspaceBreadcrumbs,
	getPyodideWorkspacePath,
	PYODIDE_WORKSPACE_DIRECTORY,
	requirePyodideWorkspacePath
} from './workspace';

describe('Pyodide workspace root', () => {
	it('treats uploads as Home and hides its parent directories', () => {
		expect(getPyodideWorkspaceBreadcrumbs('/mnt/uploads/')).toEqual([
			{ label: 'Home', path: PYODIDE_WORKSPACE_DIRECTORY }
		]);
		expect(getPyodideWorkspaceBreadcrumbs('/mnt/uploads/reports/2026/')).toEqual([
			{ label: 'Home', path: PYODIDE_WORKSPACE_DIRECTORY },
			{ label: 'reports', path: '/mnt/uploads/reports/' },
			{ label: '2026', path: '/mnt/uploads/reports/2026/' }
		]);
	});

	it('normalizes paths inside uploads and rejects escapes', () => {
		expect(getPyodideWorkspacePath('/mnt/uploads/reports/../brief.docx')).toBe(
			'/mnt/uploads/brief.docx'
		);
		for (const path of ['/', '/mnt', '/tmp/file.txt', '/mnt/uploads/../../tmp/file.txt']) {
			expect(getPyodideWorkspacePath(path)).toBeNull();
			expect(() => requirePyodideWorkspacePath(path)).toThrow(
				'Path is outside the Pyodide workspace'
			);
		}
	});

	it('falls back to uploads for invalid navigation targets', () => {
		expect(asPyodideWorkspaceDirectory('/tmp')).toBe(PYODIDE_WORKSPACE_DIRECTORY);
	});
});
