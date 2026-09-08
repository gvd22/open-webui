import { beforeEach, expect, it, vi } from 'vitest';
import { chatId, user } from '$lib/stores';
import { uploadFile, deleteFileById } from '$lib/apis/files';
import { readPyodideWorkerFile } from './DocumentViewer/pyodideFileRead';
import { createWorkspaceOutputPersistence } from './workspaceOutputPersistence';
import { createWorkspaceOutputCatalog } from './workspaceOutputs';

vi.mock('$lib/stores', async () => {
	const { writable } = await import('svelte/store');
	return {
		chatId: writable(''),
		user: writable(null),
		pyodideWorker: writable({}),
		workspaceOutputFiles: writable([])
	};
});
vi.mock('$lib/apis/files', () => ({ uploadFile: vi.fn(), deleteFileById: vi.fn() }));
vi.mock('./DocumentViewer/pyodideFileRead', () => ({ readPyodideWorkerFile: vi.fn() }));

const path = '/mnt/uploads/report.pdf';
const data = new TextEncoder().encode('snapshot').buffer;
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const setup = () => {
	const catalog = { record: vi.fn(), applyPyodideChange: vi.fn() };
	const onSaved = vi.fn();
	const onError = vi.fn();
	const persistence = createWorkspaceOutputPersistence(
		catalog as unknown as ReturnType<typeof createWorkspaceOutputCatalog>,
		onSaved,
		onError
	);
	return { ...persistence, catalog, onSaved, onError };
};

beforeEach(() => {
	vi.resetAllMocks();
	vi.stubGlobal('localStorage', { token: 'test-token' });
	chatId.set('chat-1');
	user.set({ role: 'admin' } as any);
	vi.mocked(uploadFile).mockResolvedValue({ id: 'upload-1' } as any);
	vi.mocked(deleteFileById).mockResolvedValue(true);
	vi.spyOn(console, 'error').mockImplementation(() => {});
	vi.spyOn(console, 'warn').mockImplementation(() => {});
});

it('persists an execution snapshot to its original chat after switching, without updating the new chat', async () => {
	const { schedule, catalog, onSaved } = setup();
	schedule('chat-1', path, 'message-1', false, data, false);
	chatId.set('chat-2');
	await flush();
	expect(readPyodideWorkerFile).not.toHaveBeenCalled();
	expect(uploadFile).toHaveBeenCalledWith(
		'test-token',
		expect.any(File),
		expect.objectContaining({ origin_chat_id: 'chat-1', origin_message_id: 'message-1' }),
		true,
		true
	);
	expect(catalog.record).toHaveBeenCalledWith(
		'chat-1',
		path,
		expect.objectContaining({ fileId: 'upload-1', originChatId: 'chat-1' }),
		expect.any(Object)
	);
	catalog.record.mock.calls[0][3].onConfirmed();
	expect(onSaved).not.toHaveBeenCalled();
});

it('discards an upload superseded while in flight and records only the newest version', async () => {
	const { schedule, catalog } = setup();
	let resolve!: (value: any) => void;
	vi.mocked(uploadFile).mockImplementationOnce(
		() =>
			new Promise((done) => {
				resolve = done;
			})
	);
	schedule('chat-1', path, undefined, false, data);
	await flush();
	schedule('chat-1', path, undefined, false, data);
	resolve({ id: 'obsolete' });
	await flush();
	expect(deleteFileById).toHaveBeenCalledWith('test-token', 'obsolete');
	expect(catalog.record).toHaveBeenCalledTimes(1);
	expect(catalog.record.mock.calls[0][2].fileId).toBe('upload-1');
});

it('rejects missing atomic data, respects upload permissions, and ignores temporary chats', async () => {
	const { handleChange, onError } = setup();
	const event = (id: string) =>
		new CustomEvent('pyodide:files', {
			detail: { chatId: id, paths: [path], snapshots: [] }
		});
	handleChange(event('temporary:test'));
	user.set({ role: 'user', permissions: { chat: { file_upload: false } } } as any);
	handleChange(event('chat-1'));
	await flush();
	expect(onError).not.toHaveBeenCalled();
	user.set({ role: 'admin' } as any);
	handleChange(event('chat-1'));
	await flush();
	expect(onError).toHaveBeenCalledOnce();
	expect(uploadFile).not.toHaveBeenCalled();
	expect(readPyodideWorkerFile).not.toHaveBeenCalled();
});

it('keeps uploads on unknown persistence outcomes and deletes them on definite rejection', async () => {
	const { schedule, catalog, onSaved } = setup();
	schedule('chat-1', path, 'message-1', false, data);
	await flush();
	const callbacks = catalog.record.mock.calls[0][3];
	callbacks.onConfirmed();
	expect(onSaved).toHaveBeenCalledOnce();
	callbacks.onFailed(new Error('Network unavailable'));
	expect(deleteFileById).not.toHaveBeenCalled();
	callbacks.onFailed({ status: 403 });
	expect(deleteFileById).toHaveBeenCalledWith('test-token', 'upload-1');
});
