import { describe, expect, it } from 'vitest';

import { buildChatWorkspaceArtifacts, getWorkspaceOutputArtifacts } from './chatArtifacts';

const previewOutput = (previewId: string) => ({
	type: 'function_call_output',
	output: JSON.stringify({
		type: 'web_preview.document',
		previewId,
		title: 'Preview',
		entrypoint: 'index.html',
		files: { 'index.html': { content: '<h1>Preview</h1>', mime: 'text/html' } },
		updatedAt: 10
	})
});

describe('chat workspace artifact assembly', () => {
	it('opens a new Canvas once, never on reload or returning to a message branch', () => {
		const args = {
			messages: [
				{
					role: 'assistant',
					output: [
						{
							type: 'function_call_output',
							output: JSON.stringify({
								type: 'canvas.document',
								canvasId: 'canvas-1',
								title: 'Doc',
								content: { md: 'Text' },
								updatedAt: 1
							})
						}
					]
				}
			],
			currentArtifacts: [],
			persistedCanvasDocuments: {},
			persistedWebPreviews: {},
			knownWebPreviewIds: new Set<string>(),
			selectedArtifactId: null
		};
		const first = buildChatWorkspaceArtifacts(args);
		expect(first.canvasAutoOpenId).toBe('canvas-1');
		const reloaded = buildChatWorkspaceArtifacts({
			...args,
			knownCanvasIds: new Set(['canvas-1'])
		});
		expect(reloaded.canvasAutoOpenId).toBeNull();
		const otherBranch = buildChatWorkspaceArtifacts({
			...args,
			messages: [],
			knownCanvasIds: first.knownCanvasIds
		});
		const returned = buildChatWorkspaceArtifacts({
			...args,
			knownCanvasIds: otherBranch.knownCanvasIds
		});
		expect(returned.canvasAutoOpenId).toBeNull();
	});

	it('lists saved Canvas and Preview outputs without open tabs or visible tool messages', () => {
		const canvases = { one: { title: 'Document', content: 'Saved text', updated_at: 10 } };
		const previews = {
			one: {
				title: 'Website',
				files: { 'index.html': { content: '<h1>Saved</h1>', mime: 'text/html' } },
				updated_at: 10
			}
		};
		const items = getWorkspaceOutputArtifacts([], canvases, previews);
		expect(items).toMatchObject([
			{ type: 'canvas-note', canvasId: 'one', title: 'Document', content: 'Saved text' },
			{ type: 'web-preview', previewId: 'one', title: 'Website', content: '<h1>Saved</h1>' }
		]);
		// Only the current chat's inputs are used, with no retained catalog state.
		expect(getWorkspaceOutputArtifacts([], {}, {})).toEqual([]);
	});

	it('deduplicates current and saved outputs, retaining newer local titles and content', () => {
		const current = [
			{
				type: 'canvas-note',
				canvasId: 'one',
				title: 'Local title',
				content: 'Local edit',
				updatedAt: 20
			},
			{
				type: 'web-preview',
				previewId: 'two',
				title: 'Local page',
				content: '<h1>Local</h1>',
				entrypoint: 'index.html',
				files: {},
				updatedAt: 20
			},
			{ type: 'files', content: '' }
		];
		const result = getWorkspaceOutputArtifacts(
			current,
			{
				one: { title: 'Old title', content: 'Old', updated_at: 10 }
			},
			{
				two: { title: 'Old page', files: {}, updated_at: 10 }
			}
		);
		expect(result).toHaveLength(2);
		expect(result[0]).toMatchObject({ title: 'Local title', content: 'Local edit' });
		expect(result[1]).toMatchObject({ title: 'Local page', content: '<h1>Local</h1>' });
		expect(current[0].content).toBe('Local edit');
	});

	it('reports a newly created Web Preview exactly once', () => {
		const args = {
			messages: [{ role: 'assistant', output: [previewOutput('preview-1')] }],
			currentArtifacts: [],
			persistedCanvasDocuments: {},
			persistedWebPreviews: {},
			selectedArtifactId: null
		};

		const first = buildChatWorkspaceArtifacts({ ...args, knownWebPreviewIds: new Set() });
		expect(first.newToolPreviewId).toBe('preview-1');
		expect(first.contents).toHaveLength(1);

		const replay = buildChatWorkspaceArtifacts({
			...args,
			currentArtifacts: first.contents,
			knownWebPreviewIds: first.knownWebPreviewIds
		});
		expect(replay.newToolPreviewId).toBeNull();
	});

	it('keeps a newer local Preview while old tool output is replayed', () => {
		const result = buildChatWorkspaceArtifacts({
			messages: [{ role: 'assistant', output: [previewOutput('preview-1')] }],
			currentArtifacts: [
				{
					type: 'web-preview',
					previewId: 'preview-1',
					title: 'Preview',
					entrypoint: 'index.html',
					files: { 'index.html': { content: '<h1>Local</h1>', mime: 'text/html' } },
					hasFilePayload: true,
					content: '<h1>Local</h1>',
					updatedAt: 20
				}
			],
			persistedCanvasDocuments: {},
			persistedWebPreviews: {},
			knownWebPreviewIds: new Set(['preview-1']),
			selectedArtifactId: 'preview-1'
		});

		expect(result.contents[0]).toMatchObject({
			content: '<h1>Local</h1>',
			updatedAt: 20
		});
	});
});
