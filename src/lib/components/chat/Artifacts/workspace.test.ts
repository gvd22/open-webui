import { describe, expect, it } from 'vitest';

import {
	buildWorkspaceTabs,
	getVisibleWorkspaceContents,
	getWorkspaceContentId,
	shouldShowWorkspaceTabs
} from './workspace';

describe('workspace tabs', () => {
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
			{ id: 'canvas-1', index: 0, title: 'Breakfast', kind: 'canvas-note' },
			{ id: 'jira:KOBY-42', index: 1, title: 'KOBY-42', kind: 'jira-issue' }
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
