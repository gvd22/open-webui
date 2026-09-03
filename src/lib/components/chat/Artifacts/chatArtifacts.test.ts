import { describe, expect, it } from 'vitest';

import { buildChatWorkspaceArtifacts } from './chatArtifacts';

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
