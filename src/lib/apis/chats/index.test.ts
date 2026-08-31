import { afterEach, describe, expect, it, vi } from 'vitest';

import {
	promoteTransientCanvasDocument,
	updateTransientCanvasDocument,
	updateTransientWebPreview
} from './index';

describe('workspace optimistic save clients', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('sends both the Canvas version and content hash preconditions', async () => {
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			json: vi.fn().mockResolvedValue({ updated_at: 12, contentHash: 'next-hash' })
		});
		vi.stubGlobal('fetch', fetchMock);

		await updateTransientCanvasDocument('token', 'chat-1', 'canvas-1', {
			title: 'Plan',
			content: '# Plan',
			title_edited: true,
			expected_updated_at: 11,
			expected_content_hash: 'current-hash'
		});

		expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
			expected_updated_at: 11,
			expected_content_hash: 'current-hash'
		});
	});

	it('preserves a Web Preview 409 status for conflict recovery', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: false,
				status: 409,
				json: vi.fn().mockResolvedValue({ detail: { currentUpdatedAt: 12 } })
			})
		);

		await expect(
			updateTransientWebPreview('token', 'chat-1', 'preview-1', {
				title: 'Preview',
				entrypoint: 'index.html',
				files: { 'index.html': { content: '<h1>Preview</h1>', mime: 'text/html' } },
				expected_updated_at: 11,
				expected_content_hash: 'current-hash'
			})
		).rejects.toMatchObject({ status: 409 });
	});

	it('sends Canvas version preconditions when promoting to Notes', async () => {
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			json: vi.fn().mockResolvedValue({ id: 'note-1' })
		});
		vi.stubGlobal('fetch', fetchMock);

		await promoteTransientCanvasDocument('token', 'chat-1', 'canvas-1', {
			title: 'Plan',
			content: '# Plan',
			expected_updated_at: 11,
			expected_content_hash: 'current-hash'
		});

		expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
			expected_updated_at: 11,
			expected_content_hash: 'current-hash'
		});
	});
});
