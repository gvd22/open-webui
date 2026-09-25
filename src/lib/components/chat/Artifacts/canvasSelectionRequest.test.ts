import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { writable } from 'svelte/store';

vi.mock('$lib/stores', () => ({ chatId: writable('chat-one') }));
vi.mock('$lib/apis/chats', () => ({ selectTransientCanvasDocument: vi.fn() }));
import { chatId } from '$lib/stores';
import { selectTransientCanvasDocument } from '$lib/apis/chats';
import { addCanvasSelectionToChat } from './canvasSelectionRequest';
import { WORKSPACE_ASK_AI_EVENT } from './artifactEditing';

beforeEach(() => {
	vi.stubGlobal('window', new EventTarget());
	vi.stubGlobal('localStorage', { token: 'test-token' });
	chatId.set('chat-one');
	vi.mocked(selectTransientCanvasDocument).mockReset();
});
afterEach(() => {
	vi.unstubAllGlobals();
});

const request = () => ({
	chatId: 'chat-one',
	canvasId: 'canvas-one',
	title: 'Title',
	content: 'A **bold** sentence.',
	selection: 'A bold sentence.',
	instruction: 'Shorten it',
	save: vi.fn(async () => true),
	isCurrent: () => true
});

it('flushes autosave before reading and uses the canonical hash, not a stale UI hash', async () => {
	const input = request();
	let detail: any;
	window.addEventListener(WORKSPACE_ASK_AI_EVENT, (event: any) => {
		detail = event.detail;
	});
	vi.mocked(selectTransientCanvasDocument).mockImplementation(async () => {
		expect(input.save).toHaveBeenCalledOnce();
		return { content: input.content, contentHash: 'current-hash' };
	});
	expect(await addCanvasSelectionToChat(input)).toBe(true);
	expect(detail.focus.selection).toEqual({
		text: input.content,
		displayText: input.selection,
		contentHash: 'current-hash'
	});
});

it('rejects an actual server change even when the selected words are still present', async () => {
	const input = request();
	vi.mocked(selectTransientCanvasDocument).mockResolvedValue({
		content: input.content + '\nOther user change.',
		contentHash: 'new-hash'
	});
	const listener = vi.fn();
	window.addEventListener(WORKSPACE_ASK_AI_EVENT, listener);
	await expect(addCanvasSelectionToChat(input)).rejects.toThrow('document changed');
	expect(listener).not.toHaveBeenCalled();
});

it.each(['save-failed', 'chat-switched', 'source-changed', 'cancelled'])(
	'does not attach after %s',
	async (reason) => {
		const input = request();
		if (reason === 'save-failed') input.save.mockResolvedValue(false);
		vi.mocked(selectTransientCanvasDocument).mockImplementation(async () => {
			if (reason === 'chat-switched') chatId.set('other-chat');
			if (reason === 'source-changed') input.isCurrent = () => false;
			return { content: input.content, contentHash: 'hash' };
		});
		const originalIsCurrent = input.isCurrent;
		const args = {
			...input,
			isCurrent: () => (reason === 'source-changed' ? input.isCurrent() : originalIsCurrent())
		};
		window.addEventListener(WORKSPACE_ASK_AI_EVENT, (event) => {
			if (reason === 'cancelled') event.preventDefault();
		});
		expect(await addCanvasSelectionToChat(args)).toBe(false);
	}
);
