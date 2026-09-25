import { beforeEach, expect, it, vi } from 'vitest';
import { chatId, user, workspaceOutputSaveStates } from '$lib/stores';
import { get } from 'svelte/store';
import { uploadFile, deleteFileById } from '$lib/apis/files';
import { readPyodideWorkerFile } from './DocumentViewer/pyodideFileRead';
import { createWorkspaceOutputPersistence } from './workspaceOutputPersistence';
import { createWorkspaceOutputCatalog } from './workspaceOutputs';
import { MAX_WORKSPACE_OUTPUT_UPLOAD_BYTES } from '$lib/pyodide/workspace';

vi.mock('$lib/stores', async () => {
	const { writable } = await import('svelte/store');
	return {
		chatId: writable(''),
		user: writable(null),
		pyodideWorker: writable({}),
		workspaceOutputFiles: writable([]),
		workspaceOutputSaveStates: writable({})
	};
});
vi.mock('$lib/apis/files', () => ({ uploadFile: vi.fn(), deleteFileById: vi.fn() }));
vi.mock('./DocumentViewer/pyodideFileRead', async (importOriginal) => ({
	...(await importOriginal<typeof import('./DocumentViewer/pyodideFileRead')>()),
	readPyodideWorkerFile: vi.fn()
}));

const path = '/mnt/uploads/report.pdf';
const data = { path, data: new TextEncoder().encode('snapshot').buffer, size: 8 };
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
	workspaceOutputSaveStates.set({});
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

it('keeps the saving state until the catalog confirms the upload', async () => {
	const { schedule, catalog, onSaved } = setup();
	schedule('chat-1', path, 'message-1', false, data);
	expect(get(workspaceOutputSaveStates)[`chat-1\u0000${path}`]).toBe('saving');
	await flush();
	const callbacks = catalog.record.mock.calls[0][3];
	expect(get(workspaceOutputSaveStates)[`chat-1\u0000${path}`]).toBe('saving');
	callbacks.onConfirmed();
	expect(get(workspaceOutputSaveStates)).toEqual({});
	expect(onSaved).toHaveBeenCalledOnce();
	expect(deleteFileById).not.toHaveBeenCalled();
});

it.each([
	[new Error('Network unavailable'), false],
	[{ status: 500 }, false],
	[{ status: 408 }, false],
	[{ status: 403 }, true]
])('handles catalog failure %s without claiming a successful save', async (error, remove) => {
	const { schedule, catalog, onSaved } = setup();
	schedule('chat-1', path, undefined, false, data);
	await flush();
	catalog.record.mock.calls[0][3].onFailed(error);
	expect(get(workspaceOutputSaveStates)[`chat-1\u0000${path}`]).toBe('failed');
	expect(onSaved).not.toHaveBeenCalled();
	if (remove) expect(deleteFileById).toHaveBeenCalledWith('test-token', 'upload-1');
	else expect(deleteFileById).not.toHaveBeenCalled();
});

it('ignores old confirmation callbacks after a completed queue is reused for the same path', async () => {
	const { schedule, catalog, onSaved } = setup();
	schedule('chat-1', path, undefined, false, data);
	await flush();
	const old = catalog.record.mock.calls[0][3];
	schedule('chat-1', path, undefined, false, data);
	await flush();
	old.onConfirmed();
	expect(onSaved).not.toHaveBeenCalled();
	expect(get(workspaceOutputSaveStates)[`chat-1\u0000${path}`]).toBe('saving');
	catalog.record.mock.calls[1][3].onConfirmed();
	expect(onSaved).toHaveBeenCalledOnce();
	expect(get(workspaceOutputSaveStates)).toEqual({});
});

it('recovers from an interrupted upload on the next snapshot', async () => {
	const { schedule, catalog, onError } = setup();
	vi.mocked(uploadFile).mockRejectedValueOnce(new Error('Connection lost'));
	schedule('chat-1', path, undefined, false, data);
	await flush();
	expect(get(workspaceOutputSaveStates)[`chat-1\u0000${path}`]).toBe('failed');
	expect(onError).toHaveBeenCalledOnce();
	expect(catalog.record).not.toHaveBeenCalled();
	schedule('chat-1', path, undefined, false, data);
	await flush();
	catalog.record.mock.calls[0][3].onConfirmed();
	expect(get(workspaceOutputSaveStates)).toEqual({});
});

it('keeps simultaneous same-path uploads in different chats isolated', async () => {
	const { schedule, catalog, onSaved } = setup();
	schedule('chat-1', path, undefined, false, data);
	schedule('chat-2', path, undefined, false, data);
	await flush();
	expect(catalog.record.mock.calls.map(([id]) => id)).toEqual(['chat-1', 'chat-2']);
	for (const call of catalog.record.mock.calls) call[3].onConfirmed();
	expect(onSaved).toHaveBeenCalledOnce();
	expect(onSaved.mock.calls[0][0].originChatId).toBe('chat-1');
	expect(deleteFileById).not.toHaveBeenCalled();
	expect(get(workspaceOutputSaveStates)).toEqual({});
});

it('registers oversized outputs without reading or uploading their bytes', async () => {
	const { handleChange, catalog, onError, onSaved } = setup();
	handleChange(
		new CustomEvent('pyodide:files', {
			detail: {
				chatId: 'chat-1',
				paths: [path],
				snapshots: [{ path, size: MAX_WORKSPACE_OUTPUT_UPLOAD_BYTES + 1 }]
			}
		})
	);
	await flush();
	expect(catalog.applyPyodideChange).toHaveBeenCalledOnce();
	expect(uploadFile).not.toHaveBeenCalled();
	expect(readPyodideWorkerFile).not.toHaveBeenCalled();
	expect(catalog.record).not.toHaveBeenCalled();
	expect(onSaved).not.toHaveBeenCalled();
	expect(onError).not.toHaveBeenCalled();
	expect(get(workspaceOutputSaveStates)[`chat-1\u0000${path}`]).toBe('too-large');
});

it('checks actual snapshot bytes, accepts the exact limit, and recovers on a smaller revision', async () => {
	const { schedule, catalog, onError } = setup();
	schedule('chat-1', path, undefined, false, {
		path,
		size: 1,
		data: new ArrayBuffer(MAX_WORKSPACE_OUTPUT_UPLOAD_BYTES + 1)
	});
	await flush();
	expect(uploadFile).not.toHaveBeenCalled();
	expect(onError).not.toHaveBeenCalled();
	expect(get(workspaceOutputSaveStates)[`chat-1\u0000${path}`]).toBe('too-large');
	schedule('chat-1', path, undefined, false, {
		path,
		size: MAX_WORKSPACE_OUTPUT_UPLOAD_BYTES,
		data: new ArrayBuffer(MAX_WORKSPACE_OUTPUT_UPLOAD_BYTES)
	});
	await flush();
	expect(uploadFile).toHaveBeenCalledOnce();
	catalog.record.mock.calls[0][3].onConfirmed();
	expect(get(workspaceOutputSaveStates)).toEqual({});
});

it('bounds legacy runtime reads and handles server size rejection without generic error toasts', async () => {
	const { schedule, onError } = setup();
	vi.mocked(readPyodideWorkerFile).mockRejectedValueOnce(new Error('too-large'));
	schedule('chat-1', path);
	await flush();
	expect(readPyodideWorkerFile).toHaveBeenCalledWith(
		expect.anything(),
		path,
		MAX_WORKSPACE_OUTPUT_UPLOAD_BYTES,
		expect.any(AbortSignal)
	);
	expect(uploadFile).not.toHaveBeenCalled();
	expect(get(workspaceOutputSaveStates)[`chat-1\u0000${path}`]).toBe('too-large');
	vi.mocked(uploadFile).mockRejectedValueOnce({ code: 'workspace_output_too_large' });
	schedule('chat-1', path, undefined, false, data);
	await flush();
	expect(get(workspaceOutputSaveStates)[`chat-1\u0000${path}`]).toBe('too-large');
	expect(onError).not.toHaveBeenCalled();
});
