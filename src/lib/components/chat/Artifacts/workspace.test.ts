import { describe, expect, it } from 'vitest';

import {
	buildWorkspaceTabs,
	buildWorkspaceFileContent,
	buildWorkspaceUtilityContents,
	getVisibleWorkspaceContents,
	getWorkspaceContentId,
	getWorkspaceInstanceId,
	getNextWorkspaceInstanceTitle,
	hasWorkspaceAddActions,
	isKeyboardActivationClick,
	moveWorkspaceContent,
	orderWorkspaceContents,
	replaceWorkspaceFileContent,
	resolveWorkspaceRuntime,
	shouldResetWorkspaceForChatChange,
	shouldShowWorkspaceTabs,
	WORKSPACE_FILES_ID,
	WORKSPACE_TERMINAL_ID,
	WORKSPACE_BROWSER_ID
} from './workspace';

describe('workspace tabs', () => {
	it('uses managed Terminal before Pyodide and never selects direct terminals', () => {
		expect(
			resolveWorkspaceRuntime(
				[{ url: 'https://direct.example' }, { id: 'system-1' }, { id: 'system-2' }] as any,
				'system-2',
				true
			)
		).toMatchObject({ kind: 'terminal', terminalId: 'system-2', files: true, ports: true });
		expect(resolveWorkspaceRuntime([{ url: 'https://direct.example' }] as any, null, true)).toEqual(
			{
				kind: 'pyodide',
				terminalId: null,
				files: true,
				writable: true,
				shell: false,
				ports: false
			}
		);
	});

	it('uses Pyodide only without a managed terminal', () => {
		expect(resolveWorkspaceRuntime([], null, true).kind).toBe('pyodide');
		expect(resolveWorkspaceRuntime([], null, false).kind).toBe('none');
	});

	it('shows the add control only when at least one action is available', () => {
		expect(hasWorkspaceAddActions(null, false)).toBe(false);
		expect(hasWorkspaceAddActions('terminal-1', false)).toBe(true);
		expect(hasWorkspaceAddActions(null, true)).toBe(true);
	});

	it('distinguishes keyboard activation from a pointer click fallback', () => {
		expect(isKeyboardActivationClick(0)).toBe(true);
		expect(isKeyboardActivationClick(1)).toBe(false);
		expect(isKeyboardActivationClick(2)).toBe(false);
	});

	it('resets workspace state only after leaving a concrete chat', () => {
		expect(shouldResetWorkspaceForChatChange('', '')).toBe(false);
		expect(shouldResetWorkspaceForChatChange('', 'chat-1')).toBe(false);
		expect(shouldResetWorkspaceForChatChange('chat-1', 'chat-1')).toBe(false);
		expect(shouldResetWorkspaceForChatChange('chat-1', 'chat-2')).toBe(true);
		expect(shouldResetWorkspaceForChatChange('chat-1', '')).toBe(true);
	});

	it('uses stable renderer ids and current titles', () => {
		const tabs = buildWorkspaceTabs([
			{
				type: 'canvas-note',
				content: '# Breakfast',
				canvasId: 'canvas-1',
				title: 'Breakfast'
			},
			{
				type: 'jira-issue',
				content: 'Issue details',
				workspaceId: 'jira:KOBY-42',
				title: 'KOBY-42'
			}
		]);

		expect(tabs).toEqual([
			{
				id: 'canvas-1',
				index: 0,
				title: 'Breakfast',
				kind: 'canvas-note',
				closable: true
			},
			{
				id: 'jira:KOBY-42',
				index: 1,
				title: 'KOBY-42',
				kind: 'jira-issue',
				closable: true
			}
		]);
	});

	it('provides readable labels and deterministic ids for legacy artifacts', () => {
		const contents = [
			{ type: 'canvas-note', content: '' },
			{ type: 'terminal', content: '' },
			{ type: 'iframe', content: '<main></main>' }
		];

		expect(buildWorkspaceTabs(contents).map(({ title }) => title)).toEqual([
			'Document',
			'Terminal',
			'Preview'
		]);
		expect(getWorkspaceContentId(contents[2], 2)).toBe('iframe:2');
	});

	it('keeps the workspace tab strip visible whenever a renderer is open', () => {
		const document = { type: 'canvas-note', content: '', canvasId: 'canvas-1' };

		expect(shouldShowWorkspaceTabs([])).toBe(false);
		expect(shouldShowWorkspaceTabs([document])).toBe(true);
		expect(shouldShowWorkspaceTabs([document, { ...document, canvasId: 'canvas-2' }])).toBe(true);
	});

	it('builds Files, Terminal, and Browser as sibling workspace items', () => {
		const contents = buildWorkspaceUtilityContents({
			showFiles: true,
			showTerminal: true,
			showBrowser: true
		});

		expect(contents.map((content) => content.workspaceId)).toEqual([
			WORKSPACE_FILES_ID,
			WORKSPACE_TERMINAL_ID,
			WORKSPACE_BROWSER_ID
		]);
		expect(buildWorkspaceTabs(contents).map(({ title, kind }) => ({ title, kind }))).toEqual([
			{ title: 'Files', kind: 'workspace-files' },
			{ title: 'Terminal', kind: 'workspace-terminal' },
			{ title: 'Browser', kind: 'workspace-browser' }
		]);
		expect(buildWorkspaceTabs(contents).map(({ closable }) => closable)).toEqual([
			true,
			true,
			true
		]);
	});

	it('creates stable utility instance ids and non-colliding titles', () => {
		expect(getWorkspaceInstanceId('terminal', 'one')).toBe('workspace:terminal:one');
		expect(getWorkspaceInstanceId('browser', 'two')).toBe('workspace:browser:two');
		expect(getNextWorkspaceInstanceTitle('terminal', [])).toBe('Terminal');
		expect(getNextWorkspaceInstanceTitle('terminal', ['Terminal', 'Terminal 2'])).toBe(
			'Terminal 3'
		);
		expect(getNextWorkspaceInstanceTitle('browser', ['Browser 2'])).toBe('Browser 3');
	});

	it('keeps exactly one file object tab and replaces it in place', () => {
		const first = replaceWorkspaceFileContent([], '/workspace/reports/brief.md');
		const repeated = replaceWorkspaceFileContent(first, '/workspace/reports/brief.md');
		const second = replaceWorkspaceFileContent(repeated, '/workspace/data.csv');

		expect(repeated).toBe(first);
		expect(buildWorkspaceFileContent('/workspace/reports/brief.md')).toMatchObject({
			type: 'workspace-file',
			workspaceId: 'workspace:file:/workspace/reports/brief.md',
			title: 'brief.md',
			path: '/workspace/reports/brief.md'
		});
		expect(buildWorkspaceTabs(second).map(({ id, title }) => ({ id, title }))).toEqual([
			{ id: 'workspace:file:/workspace/data.csv', title: 'data.csv' }
		]);
	});

	it('preserves a custom tab order and appends unknown items', () => {
		const files = { type: 'workspace-files', content: '', workspaceId: WORKSPACE_FILES_ID };
		const canvas = { type: 'canvas-note', content: '', canvasId: 'canvas-1' };
		const terminal = {
			type: 'workspace-terminal',
			content: '',
			workspaceId: WORKSPACE_TERMINAL_ID
		};

		expect(
			orderWorkspaceContents([files, canvas, terminal], ['canvas-1', WORKSPACE_FILES_ID])
		).toEqual([canvas, files, terminal]);
	});

	it('moves tabs using stable ids without changing their contents', () => {
		const files = { type: 'workspace-files', content: '', workspaceId: WORKSPACE_FILES_ID };
		const canvas = { type: 'canvas-note', content: '', canvasId: 'canvas-1' };
		const terminal = {
			type: 'workspace-terminal',
			content: '',
			workspaceId: WORKSPACE_TERMINAL_ID
		};

		expect(
			moveWorkspaceContent([files, canvas, terminal], WORKSPACE_FILES_ID, WORKSPACE_TERMINAL_ID)
		).toEqual([canvas, terminal, files]);
		expect(moveWorkspaceContent([files, canvas], 'missing', 'canvas-1')).toEqual([files, canvas]);
	});

	it('hides a closed workspace view without changing its source document', () => {
		const first = { type: 'canvas-note', content: '', canvasId: 'canvas-1' };
		const second = { type: 'terminal', content: '', workspaceId: 'terminal:1' };
		const contents = [first, second];
		const closedIds = new Set(['canvas-1']);

		expect(getVisibleWorkspaceContents(contents, closedIds)).toEqual([second]);

		// Selecting the Canvas again removes its view-only close state.
		closedIds.delete('canvas-1');
		expect(getVisibleWorkspaceContents(contents, closedIds)).toEqual([first, second]);
		expect(contents).toEqual([first, second]);
	});
});
