import { describe, expect, it } from 'vitest';
import {
	buildWorkspaceFileContent,
	buildWorkspaceTabs,
	getWorkspaceDocumentFormat,
	getWorkspaceFileRefreshAction,
	getWorkspaceFileUpdateAction,
	isWorkspaceOpenRequestForChat,
	upsertWorkspaceFileContent,
	WORKSPACE_FILES_ID
} from './workspace';

describe('file workspace', () => {
	it('opens documents, text and unknown files as distinct tabs', () => {
		const paths = ['report.pdf', 'slides.pptx', 'notes.md', 'data.json', 'binary.zip'];
		const files = paths.map((name) => buildWorkspaceFileContent(`/mnt/uploads/${name}`));
		expect(new Set(files.map((file) => file.workspaceId)).size).toBe(paths.length);
		expect(buildWorkspaceTabs(files).every((tab) => tab.closable)).toBe(true);
	});
	it('keeps Files fixed and non-closable', () => {
		expect(
			buildWorkspaceTabs([
				{ type: 'workspace-files', workspaceId: WORKSPACE_FILES_ID, title: 'Files', content: '' }
			])[0].closable
		).toBe(false);
	});
	it('deduplicates files while updating requested page and backing file', () => {
		const path = '/mnt/uploads/report.pdf';
		const files = upsertWorkspaceFileContent([], path, 2, 'file-1');
		expect(upsertWorkspaceFileContent(files, path, 2, 'file-1')).toBe(files);
		expect(upsertWorkspaceFileContent(files, path, 3, 'file-2')).toEqual([
			buildWorkspaceFileContent(path, 3, 'file-2')
		]);
	});
	it('supports all document formats without guessing from a parent directory', () => {
		for (const format of ['pdf', 'docx', 'pptx', 'csv', 'xls', 'xlsx']) {
			expect(getWorkspaceDocumentFormat(`/mnt/uploads/report.${format.toUpperCase()}`)).toBe(
				format
			);
		}
		expect(getWorkspaceDocumentFormat('/report.pdf/data.txt')).toBeNull();
	});
	it('rejects cross-chat requests while keeping existing path-only requests compatible', () => {
		expect(isWorkspaceOpenRequestForChat('other', 'active')).toBe(false);
		expect(isWorkspaceOpenRequestForChat('active', 'active')).toBe(true);
		expect(isWorkspaceOpenRequestForChat(undefined, 'active')).toBe(true);
	});
	it('refreshes only affected active files and handles lifecycle events', () => {
		const path = '/mnt/uploads/report.csv';
		expect(getWorkspaceFileRefreshAction(['/other'], path)).toBe('ignore');
		expect(getWorkspaceFileRefreshAction(undefined, path)).toBe('refresh');
		expect(getWorkspaceFileRefreshAction([path], path)).toBe('refresh');
		expect(getWorkspaceFileUpdateAction({ path, kind: 'deleted' }, path)).toBe('deleted');
		expect(
			getWorkspaceFileUpdateAction({ previousPath: path, path: '/new', kind: 'renamed' }, path)
		).toBe('renamed');
		expect(getWorkspaceFileUpdateAction({ path: '/other', kind: 'changed' }, path)).toBe('ignore');
	});
});
