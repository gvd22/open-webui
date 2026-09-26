import { describe, expect, it, vi } from 'vitest';

import {
	asPyodideWorkspaceDirectory,
	getPyodideWorkspaceBreadcrumbs,
	getPyodideWorkspacePath,
	isValidPyodideEntryName,
	PYODIDE_WORKSPACE_DIRECTORY,
	requirePyodideWorkspacePath
} from './workspace';
import {
	getPyodideRequestTimeout,
	PYODIDE_EXECUTION_TIMEOUT_MS,
	PYODIDE_PREPARE_TIMEOUT_MS,
	PYODIDE_QUEUE_TIMEOUT_MS,
	terminatePyodideWorker
} from './runtimeTimeouts';

describe('Pyodide workspace root', () => {
	it('allows queued and cold-start work more time than executing code', () => {
		expect(getPyodideRequestTimeout('request-queued')).toBe(PYODIDE_QUEUE_TIMEOUT_MS);
		expect(getPyodideRequestTimeout('loading-runtime')).toBe(PYODIDE_PREPARE_TIMEOUT_MS);
		expect(getPyodideRequestTimeout('executing-code')).toBe(PYODIDE_EXECUTION_TIMEOUT_MS);
	});

	it('notifies pending requests before terminating a shared worker', () => {
		const target = new EventTarget();
		const terminate = vi.fn();
		const worker = Object.assign(target, { terminate }) as unknown as Worker;
		const errors: Event[] = [];
		worker.addEventListener('error', (event) => errors.push(event));

		terminatePyodideWorker(worker, 'timed out');

		expect(terminate).toHaveBeenCalledOnce();
		expect(errors).toHaveLength(1);
		expect(errors[0]).toMatchObject({ message: 'timed out', pyodideTerminating: true });
	});
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

	it('accepts ordinary entry names and rejects path-like names', () => {
		expect(isValidPyodideEntryName('Quarterly report 2026.docx')).toBe(true);
		for (const name of [
			'',
			'.',
			'..',
			'../report.pdf',
			'folder/file.pdf',
			'folder\\file.pdf',
			'bad\nname'
		]) {
			expect(isValidPyodideEntryName(name)).toBe(false);
		}
	});
});
