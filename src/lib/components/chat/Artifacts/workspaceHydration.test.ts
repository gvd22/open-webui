import { describe, expect, it, vi } from 'vitest';
import { get, writable } from 'svelte/store';
import { createWorkspaceReferenceHydrator } from './chatArtifacts';
import { buildWorkspaceFilesContent, type WorkspaceContent } from './workspace';
import type { CanvasNoteArtifact } from './canvas';
import type { WebPreviewArtifact } from './webPreview';

const references: [CanvasNoteArtifact, WebPreviewArtifact] = [
	{
		type: 'canvas-note',
		canvasId: 'one',
		title: 'Document',
		content: '',
		source: 'tool',
		updatedAt: 10,
		hasContentPayload: false
	},
	{
		type: 'web-preview',
		previewId: 'one',
		title: 'Preview',
		content: '',
		source: 'tool',
		entrypoint: 'index.html',
		files: {},
		updatedAt: 10,
		hasFilePayload: false
	}
];
const response = {
	chat: {
		_canvas_documents: { one: { content: 'Saved', updated_at: 20 } },
		_web_preview_documents: {
			one: {
				files: { 'index.html': { content: '<h1>Saved</h1>', mime: 'text/html' } },
				updated_at: 20
			}
		}
	}
};
const deferred = () => {
	let resolve!: (value: typeof response) => void;
	let reject!: (error: Error) => void;
	const promise = new Promise<typeof response>((yes, no) => {
		resolve = yes;
		reject = no;
	});
	return { promise, resolve, reject };
};
const setup = (loadChat: () => Promise<typeof response>) => {
	let chatId = 'chat-a';
	const contents = writable<WorkspaceContent[] | null>(structuredClone(references));
	const onLoaded = vi.fn(),
		onError = vi.fn();
	const hydrator = createWorkspaceReferenceHydrator({
		contents,
		getChatId: () => chatId,
		loadChat,
		onLoaded,
		onError
	});
	return {
		...hydrator,
		contents,
		onLoaded,
		onError,
		switchChat: (id: string) => {
			chatId = id;
		}
	};
};

describe('Workspace reference hydration', () => {
	it('deduplicates requests and merges into current contents without overwriting a newer edit', async () => {
		const pending = deferred();
		const load = vi.fn(() => pending.promise);
		const h = setup(load);
		const first = h.hydrate(references);
		await h.hydrate(references);
		expect(load).toHaveBeenCalledTimes(1);
		const edited: WorkspaceContent = {
			...references[0],
			title: 'Local',
			content: 'Local edit',
			updatedAt: 30,
			contentHash: 'new-local-hash',
			hasContentPayload: true
		};
		const files = buildWorkspaceFilesContent();
		h.contents.set([edited, references[1], files]);
		pending.resolve(response);
		await first;
		expect(get(h.contents)).toMatchObject([
			edited,
			{ content: '<h1>Saved</h1>', hasFilePayload: true },
			files
		]);
		expect(h.onLoaded).toHaveBeenCalledOnce();
		expect(h.onError).not.toHaveBeenCalled();
	});

	it.each(['chat switch', 'reset', 'newer request', 'repeated key'])(
		'ignores a late response after %s',
		async (reason) => {
			const pending = deferred();
			const h = setup(vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValue(response));
			const first = h.hydrate(references);
			if (reason === 'chat switch') h.switchChat('chat-b');
			if (reason === 'reset') h.reset();
			if (reason === 'newer request' || reason === 'repeated key')
				await h.hydrate(references.map((item) => ({ ...item, updatedAt: 11 })));
			if (reason === 'repeated key') await h.hydrate(references);
			const expected = get(h.contents);
			h.onLoaded.mockClear();
			const stale = structuredClone(response);
			for (const document of Object.values(stale.chat._canvas_documents)) {
				Object.assign(document, { content_hash: 'stale-hash', note_id: 'stale-note' });
			}
			pending.resolve(stale);
			await first;
			expect(get(h.contents)).toBe(expected);
			expect(h.onLoaded).not.toHaveBeenCalled();
		}
	);

	it('ignores stale failures and permits a retry after a current failure', async () => {
		const pending = deferred();
		const load = vi
			.fn()
			.mockReturnValueOnce(pending.promise)
			.mockRejectedValueOnce(new Error('Offline'))
			.mockResolvedValue(response);
		const h = setup(load);
		const first = h.hydrate(references);
		h.reset();
		pending.reject(new Error('Old request'));
		await first;
		expect(h.onError).not.toHaveBeenCalled();
		await h.hydrate(references);
		expect(h.onError).toHaveBeenCalledOnce();
		await h.hydrate(references);
		expect(h.onLoaded).toHaveBeenCalledOnce();
	});

	it('does not fetch for unsaved chats, Files or already hydrated content', async () => {
		const load = vi.fn().mockResolvedValue(response);
		const h = setup(load);
		await h.hydrate([buildWorkspaceFilesContent()]);
		await h.hydrate([{ ...references[1], hasFilePayload: true }]);
		h.switchChat('');
		await h.hydrate(references);
		expect(load).not.toHaveBeenCalled();
	});
});
