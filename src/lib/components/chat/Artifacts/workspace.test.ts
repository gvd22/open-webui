import { describe, expect, it } from 'vitest';

import {
	buildWorkspaceFileContent,
	buildWorkspaceFilesContent,
	buildWorkspaceTabs,
	getDefaultWorkspaceContentId,
	getVisibleWorkspaceContents,
	getWorkspaceContentId,
	getWorkspaceDocumentFormat,
	getWorkspaceDocumentFormatForViewer,
	getWorkspaceFileOpenTarget,
	getWorkspaceFileRefreshAction,
	getWorkspaceFileUpdateAction,
	getWorkspaceModelFocus,
	isKeyboardActivationClick,
	isWorkspaceDocumentPath,
	limitWorkspaceFileContents,
	moveWorkspaceContent,
	orderWorkspaceContents,
	resolveWorkspaceRuntime,
	shouldResetWorkspaceForChatChange,
	shouldShowWorkspaceTabs,
	upsertWorkspaceFileContent,
	WORKSPACE_FILES_ID,
	type WorkspaceContent
} from './workspace';

describe('Pyodide workspace', () => {
	it('exposes only Pyodide Files when the interpreter is available', () => {
		expect(resolveWorkspaceRuntime(true)).toEqual({
			kind: 'pyodide',
			files: true,
			writable: true
		});
		expect(resolveWorkspaceRuntime(false)).toEqual({
			kind: 'none',
			files: false,
			writable: false
		});
		expect(getDefaultWorkspaceContentId()).toBe(WORKSPACE_FILES_ID);
		expect(buildWorkspaceFilesContent()).toMatchObject({
			type: 'workspace-files',
			workspaceId: WORKSPACE_FILES_ID
		});
	});

	it('keeps model focus limited to the visible Canvas or Web Preview', () => {
		const contents = [
			{ type: 'canvas-note', content: '# Plan', canvasId: 'canvas-1' },
			{ type: 'web-preview', content: '<h1>App</h1>', previewId: 'preview-1' },
			{ type: 'workspace-files', content: '', workspaceId: WORKSPACE_FILES_ID }
		];
		expect(getWorkspaceModelFocus(contents, 'canvas-1', true)).toEqual({
			kind: 'canvas',
			id: 'canvas-1'
		});
		expect(getWorkspaceModelFocus(contents, 'preview-1', true)).toEqual({
			kind: 'web_preview',
			id: 'preview-1'
		});
		expect(getWorkspaceModelFocus(contents, WORKSPACE_FILES_ID, true)).toBeUndefined();
		expect(getWorkspaceModelFocus(contents, 'canvas-1', false)).toBeUndefined();
	});

	it('builds stable tabs and legacy renderer ids', () => {
		const contents = [
			{ type: 'canvas-note', content: '# Breakfast', canvasId: 'canvas-1', title: 'Breakfast' },
			{ type: 'iframe', content: '<main></main>' }
		];
		const tabs = buildWorkspaceTabs(contents);
		expect(tabs[0]).toEqual({
			id: 'canvas-1',
			index: 0,
			title: 'Breakfast',
			kind: 'canvas-note',
			closable: true
		});
		const legacyId = getWorkspaceContentId(contents[1], 1);
		expect(legacyId).toMatch(/^iframe:[a-z0-9]+$/);
		expect(getWorkspaceContentId(contents[1], 99)).toBe(legacyId);
	});

	it('keeps workspace state and tabs stable', () => {
		expect(isKeyboardActivationClick(0)).toBe(true);
		expect(isKeyboardActivationClick(1)).toBe(false);
		expect(shouldResetWorkspaceForChatChange('', 'chat-1')).toBe(false);
		expect(shouldResetWorkspaceForChatChange('chat-1', 'chat-2')).toBe(true);
		expect(shouldShowWorkspaceTabs([])).toBe(false);
		expect(shouldShowWorkspaceTabs([{ type: 'canvas-note', content: '' }])).toBe(true);
	});

	it('keeps at most four open documents without evicting the active one', () => {
		let contents: WorkspaceContent[] = [];
		let recency: string[] = [];
		const activeId = 'workspace:file:/mnt/uploads/0.pdf';
		for (let index = 0; index < 10; index += 1) {
			const path = `/mnt/uploads/${index}.pdf`;
			const id = `workspace:file:${path}`;
			contents = upsertWorkspaceFileContent(contents, path);
			recency = [...recency.filter((candidate) => candidate !== id), id];
			const limited = limitWorkspaceFileContents(contents, recency, activeId, 4);
			expect(limited.evictedIds).not.toContain(activeId);
			contents = limited.contents;
			recency = limited.recency;
		}
		expect(contents.map((content) => content.path)).toEqual([
			'/mnt/uploads/0.pdf',
			'/mnt/uploads/7.pdf',
			'/mnt/uploads/8.pdf',
			'/mnt/uploads/9.pdf'
		]);
	});

	it('updates one open document tab and preserves target pages', () => {
		const first = upsertWorkspaceFileContent([], '/mnt/uploads/brief.docx');
		const repeated = upsertWorkspaceFileContent(first, '/mnt/uploads/brief.docx', 2);
		expect(repeated).toMatchObject([{ targetPage: 2 }]);
		expect(upsertWorkspaceFileContent(repeated, '/mnt/uploads/brief.docx', 2)).toBe(repeated);
		expect(buildWorkspaceFileContent('/mnt/uploads/brief.docx', 2)).toMatchObject({
			workspaceId: 'workspace:file:/mnt/uploads/brief.docx',
			fileFormat: 'docx',
			targetPage: 2
		});
	});

	it('handles refresh, delete, and rename events explicitly', () => {
		expect(getWorkspaceFileRefreshAction(['/one.docx'], '/one.docx', true)).toBe('refresh');
		expect(getWorkspaceFileRefreshAction(['/one.docx'], '/one.docx', false)).toBe('defer');
		expect(getWorkspaceFileRefreshAction(['/other.docx'], '/one.docx', true)).toBe('ignore');
		expect(
			getWorkspaceFileUpdateAction({ path: '/one.docx', kind: 'deleted' }, '/one.docx', true)
		).toBe('deleted');
		expect(
			getWorkspaceFileUpdateAction(
				{ path: '/renamed.docx', previousPath: '/one.docx', kind: 'renamed' },
				'/one.docx',
				true
			)
		).toBe('renamed');
	});

	it('routes only supported document formats to the viewer', () => {
		for (const path of [
			'/mnt/uploads/report.pdf',
			'/mnt/uploads/report.docx',
			'/mnt/uploads/deck.pptx',
			'/mnt/uploads/table.xlsx',
			'/mnt/uploads/legacy.xls'
		]) {
			expect(getWorkspaceDocumentFormat(path)).not.toBeNull();
			expect(getWorkspaceDocumentFormatForViewer(path, true)).toBe(
				getWorkspaceDocumentFormat(path)
			);
		}
		for (const path of ['/mnt/uploads/data.csv', '/mnt/uploads/report.odt']) {
			expect(isWorkspaceDocumentPath(path)).toBe(false);
			expect(getWorkspaceFileOpenTarget(path)).toBe('files');
		}
	});

	it('reorders and closes views without changing source content', () => {
		const files = { type: 'workspace-files', content: '', workspaceId: WORKSPACE_FILES_ID };
		const canvas = { type: 'canvas-note', content: '', canvasId: 'canvas-1' };
		const preview = { type: 'web-preview', content: '', previewId: 'preview-1' };
		expect(orderWorkspaceContents([files, canvas, preview], ['canvas-1'])).toEqual([
			canvas,
			files,
			preview
		]);
		expect(moveWorkspaceContent([files, canvas, preview], WORKSPACE_FILES_ID, 'preview-1')).toEqual([
			canvas,
			preview,
			files
		]);
		expect(getVisibleWorkspaceContents([canvas, preview], new Set(['canvas-1']))).toEqual([
			preview
		]);
	});
});
