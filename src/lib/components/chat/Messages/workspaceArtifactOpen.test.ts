import { beforeEach, describe, expect, it, vi } from 'vitest';
import { get, type Writable } from 'svelte/store';
import { artifactContents, artifactCode, chatId, showControls } from '$lib/stores';
import { selectTransientCanvasDocument, selectTransientWebPreview } from '$lib/apis/chats';
import {
	openCanvasArtifact,
	openWebPreviewArtifact,
	selectWorkspaceArtifact
} from './workspaceArtifactOpen';
import type { CanvasNoteArtifact } from '../Artifacts/canvas';
import type { WebPreviewArtifact } from '../Artifacts/webPreview';

const contents = artifactContents as unknown as Writable<
	(CanvasNoteArtifact | WebPreviewArtifact)[] | null
>;

vi.mock('$lib/stores', async () => {
	const { writable } = await import('svelte/store');
	return Object.fromEntries(
		[
			'artifactContents',
			'artifactCode',
			'chatId',
			'showControls',
			'showArtifacts',
			'showEmbeds',
			'workspaceOpenRequestId'
		].map((key) => [key, writable(null)])
	);
});
vi.mock('$lib/apis/chats', () => ({
	selectTransientCanvasDocument: vi.fn(),
	selectTransientWebPreview: vi.fn()
}));
vi.mock('$lib/utils', () => ({ createMessagesList: vi.fn() }));

const canvas: CanvasNoteArtifact = {
	type: 'canvas-note',
	canvasId: 'canvas-1',
	title: 'Canvas',
	content: 'Old',
	source: 'tool',
	updatedAt: 1
};
const preview: WebPreviewArtifact = {
	type: 'web-preview',
	previewId: 'preview-1',
	title: 'Preview',
	content: 'Old',
	source: 'tool',
	entrypoint: 'index.html',
	files: { 'index.html': { content: 'Old', mime: 'text/html' } },
	updatedAt: 1
};

beforeEach(() => {
	vi.resetAllMocks();
	vi.stubGlobal('localStorage', { token: 'test-token' });
	chatId.set('chat-1');
	contents.set([]);
	artifactCode.set('other');
	showControls.set(false);
	vi.mocked(selectTransientCanvasDocument).mockResolvedValue({
		content: 'New',
		contentHash: 'hash',
		updated_at: 2
	} as any);
	vi.mocked(selectTransientWebPreview).mockResolvedValue({
		files: { 'index.html': { content: 'New', mime: 'text/html' } },
		updated_at: 2
	} as any);
});

describe('shared artifact selection', () => {
	it.each([canvas, preview])(
		'hydrates $type from cards and tabs without duplicate objects or tab focus changes',
		async (artifact) => {
			const open =
				artifact.type === 'canvas-note'
					? () => openCanvasArtifact(artifact, vi.fn())
					: () => openWebPreviewArtifact(artifact, vi.fn());
			await open();
			await open();
			expect(get(contents)).toHaveLength(1);
			expect(get(contents)?.[0].content).toBe('New');
			artifactCode.set('other');
			showControls.set(false);
			await selectWorkspaceArtifact(artifact, 'chat-1');
			expect(get(artifactCode)).toBe('other');
			expect(get(showControls)).toBe(false);
			contents.set([]);
			await selectWorkspaceArtifact(artifact, 'chat-1');
			expect(get(contents)).toEqual([]);
		}
	);

	it('ignores a response arriving after a chat switch', async () => {
		let resolve!: (value: any) => void;
		vi.mocked(selectTransientCanvasDocument).mockReturnValue(
			new Promise((done) => {
				resolve = done;
			})
		);
		const pending = openCanvasArtifact(canvas, vi.fn());
		chatId.set('chat-2');
		resolve({ content: 'Wrong chat', updated_at: 3 });
		await pending;
		expect(get(contents)).toEqual([]);
		expect(get(artifactCode)).toBe('other');
		expect(await selectWorkspaceArtifact(canvas, 'chat-1')).toBe(false);
		expect(selectTransientCanvasDocument).toHaveBeenCalledTimes(1);
	});

	it('reports a failed card selection without opening and does not fetch legacy previews', async () => {
		const onError = vi.fn();
		vi.mocked(selectTransientCanvasDocument).mockRejectedValue(new Error('Offline'));
		await openCanvasArtifact(canvas, onError);
		expect(onError).toHaveBeenCalledOnce();
		expect(get(showControls)).toBe(false);
		await openWebPreviewArtifact({ ...preview, source: 'legacy' }, onError);
		expect(selectTransientWebPreview).not.toHaveBeenCalled();
		expect(get(artifactCode)).toBe('preview-1');
	});
});
