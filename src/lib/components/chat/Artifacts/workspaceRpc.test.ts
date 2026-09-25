import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readWorkspaceText } from '$lib/pyodide/readWorkspaceText';
import { displayWorkspaceOutput } from './workspaceDisplay';
import { handleWorkspaceRpc } from './workspaceRpc';

vi.mock('$lib/pyodide/readWorkspaceText', () => ({ readWorkspaceText: vi.fn() }));
vi.mock('./workspaceDisplay', () => ({ displayWorkspaceOutput: vi.fn() }));

describe('workspace RPC', () => {
	const worker = {} as Worker;
	const getWorker = vi.fn(() => worker);
	const reply = vi.fn();
	beforeEach(() => {
		vi.resetAllMocks();
		getWorker.mockReturnValue(worker);
	});

	it('opens the requested chat output without starting a worker', async () => {
		const result = { status: 'opening', path: '/mnt/uploads/report.pdf' };
		vi.mocked(displayWorkspaceOutput).mockResolvedValue(result);
		await handleWorkspaceRpc(
			'workspace:display_file',
			{ path: result.path },
			'chat-1',
			reply,
			getWorker
		);
		expect(displayWorkspaceOutput).toHaveBeenCalledWith('chat-1', result.path);
		expect(reply.mock.calls).toEqual([[result]]);
		expect(getWorker).not.toHaveBeenCalled();
	});

	it.each([
		[undefined, 1],
		[-5, 1],
		[100, 100],
		[Infinity, 512000]
	])('bounds runtime reads with byte limit %s', async (max_bytes, expected) => {
		vi.mocked(readWorkspaceText).mockResolvedValue('contents');
		await handleWorkspaceRpc(
			'workspace:read_runtime_file',
			{
				runtime: 'pyodide',
				source_path: '/mnt/uploads/data.csv',
				max_bytes
			},
			'chat-1',
			reply,
			getWorker
		);
		expect(readWorkspaceText).toHaveBeenCalledWith(worker, '/mnt/uploads/data.csv', expected);
		expect(reply.mock.calls).toEqual([[{ content: 'contents' }]]);
	});

	it('rejects unsupported runtimes before accessing the worker', async () => {
		await handleWorkspaceRpc(
			'workspace:read_runtime_file',
			{ runtime: 'terminal' },
			'chat-1',
			reply,
			getWorker
		);
		expect(getWorker).not.toHaveBeenCalled();
		expect(reply.mock.calls).toEqual([[{ error: 'No supported runtime is active.' }]]);
	});

	it.each(['workspace:display_file', 'workspace:read_runtime_file'] as const)(
		'replies with errors from %s',
		async (type) => {
			vi.mocked(displayWorkspaceOutput).mockRejectedValue(new Error('Chat changed'));
			vi.mocked(readWorkspaceText).mockRejectedValue(new Error('Chat changed'));
			await handleWorkspaceRpc(type, { runtime: 'pyodide' }, 'chat-1', reply, getWorker);
			expect(reply.mock.calls).toEqual([[{ error: 'Chat changed' }]]);
		}
	);
});
