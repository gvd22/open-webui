import { beforeEach, expect, it, vi } from 'vitest';
import { chatId, config, user, workspaceOutputFiles, pyodideWorker } from '$lib/stores';
import { getFileById } from '$lib/apis/files';
import { displayFileHandler } from '$lib/utils';
import { readPyodideWorkerFile } from './DocumentViewer/pyodideFileRead';
import { displayWorkspaceOutput } from './workspaceDisplay';
import { createWorkspaceOutputFile, getWorkspaceOutputStorageLabel } from './workspaceOutputs';

vi.mock('$lib/stores', async () => {
	const { writable } = await import('svelte/store');
	return Object.fromEntries(
		[
			'chatId',
			'config',
			'user',
			'pyodideWorker',
			'workspaceOutputFiles',
			'showControls',
			'showFileNavPath',
			'showArtifacts'
		].map((key) => [key, writable(null)])
	);
});
vi.mock('$lib/apis/files', () => ({ getFileById: vi.fn() }));
vi.mock('$lib/utils', () => ({ displayFileHandler: vi.fn() }));
vi.mock('./DocumentViewer/pyodideFileRead', () => ({ readPyodideWorkerFile: vi.fn() }));
const path = '/mnt/uploads/report.pdf';
const file = createWorkspaceOutputFile(path, {
	fileId: 'file-1',
	persistedAt: 10,
	updatedAt: 10,
	originChatId: 'chat-1'
})!;

beforeEach(() => {
	vi.resetAllMocks();
	vi.stubGlobal('localStorage', { token: 'test' });
	chatId.set('chat-1');
	config.set({
		features: { enable_document_viewer: true, enable_code_interpreter: true },
		code: { interpreter_engine: 'pyodide' }
	} as any);
	user.set({ role: 'user', permissions: { features: { code_interpreter: true } } } as any);
	workspaceOutputFiles.set([file]);
	pyodideWorker.set({} as Worker);
	vi.mocked(getFileById).mockResolvedValue({ id: 'file-1' });
	vi.mocked(readPyodideWorkerFile).mockResolvedValue(new ArrayBuffer(1));
});

it('opens a saved output without the runtime, but checks the server reference', async () => {
	pyodideWorker.set(null);
	expect(await displayWorkspaceOutput('chat-1', path)).toMatchObject({ status: 'opening' });
	expect(getFileById).toHaveBeenCalledWith('test', 'file-1');
	expect(readPyodideWorkerFile).not.toHaveBeenCalled();
	expect(displayFileHandler).toHaveBeenCalledWith(path, expect.anything(), {
		fileId: 'file-1',
		chatId: 'chat-1'
	});
});

it('uses the current browser file rather than an older saved snapshot', async () => {
	workspaceOutputFiles.set([{ ...file, updatedAt: 20 }]);
	await displayWorkspaceOutput('chat-1', path);
	expect(getFileById).not.toHaveBeenCalled();
	expect(readPyodideWorkerFile).toHaveBeenCalled();
	expect(displayFileHandler).toHaveBeenCalledWith(path, expect.anything(), {
		fileId: undefined,
		chatId: 'chat-1'
	});
});

it('can reopen legacy saved outputs without version timestamps or a worker', async () => {
	workspaceOutputFiles.set([{ ...file, persistedAt: undefined }]);
	pyodideWorker.set(null);
	await displayWorkspaceOutput('chat-1', path);
	expect(getFileById).toHaveBeenCalledWith('test', 'file-1');
	expect(readPyodideWorkerFile).not.toHaveBeenCalled();
	expect(getWorkspaceOutputStorageLabel({ ...file, persistedAt: undefined })).toBe(
		'Saved version available'
	);
});

it('does not open a file after switching chats while checking it', async () => {
	vi.mocked(getFileById).mockImplementation(async () => {
		chatId.set('chat-2');
		return { id: 'file-1' };
	});
	await expect(displayWorkspaceOutput('chat-1', path)).rejects.toThrow('changed');
	expect(displayFileHandler).not.toHaveBeenCalled();
});

it('rejects foreign, unknown, deleted, and unauthorized outputs without opening', async () => {
	await expect(displayWorkspaceOutput('chat-2', path)).rejects.toThrow('active');
	await expect(displayWorkspaceOutput('chat-1', '/mnt/uploads/unknown.pdf')).rejects.toThrow(
		'not an output'
	);
	await expect(displayWorkspaceOutput('chat-1', '/mnt/uploads/../secret.pdf')).rejects.toThrow(
		'Invalid'
	);
	vi.mocked(getFileById).mockRejectedValue(new Error('Not found'));
	await expect(displayWorkspaceOutput('chat-1', path)).rejects.toThrow('Not found');
	user.set({ role: 'user', permissions: {} } as any);
	await expect(displayWorkspaceOutput('chat-1', path)).rejects.toThrow('disabled');
	expect(displayFileHandler).not.toHaveBeenCalled();
});

it('distinguishes durable, transient, dirty, saving, and failed versions', () => {
	expect(getWorkspaceOutputStorageLabel(file)).toBe('Saved to chat');
	expect(getWorkspaceOutputStorageLabel({ ...file, fileId: undefined })).toBe(
		'Only in this browser'
	);
	expect(getWorkspaceOutputStorageLabel({ ...file, updatedAt: 20 })).toBe('Changes not saved');
	expect(getWorkspaceOutputStorageLabel(file, 'saving')).toBe('Saving...');
	expect(getWorkspaceOutputStorageLabel(file, 'failed')).toBe('Saving failed');
});
