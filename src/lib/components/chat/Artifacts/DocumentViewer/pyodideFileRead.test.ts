import { afterEach, describe, expect, it, vi } from 'vitest';

import { readPyodideWorkerFile } from './pyodideFileRead';

const createWorker = () => {
	const listeners = new Set<(event: MessageEvent) => void>();
	const worker = {
		addEventListener: vi.fn((_type: 'message', listener: (event: MessageEvent) => void) => {
			listeners.add(listener);
		}),
		removeEventListener: vi.fn((_type: 'message', listener: (event: MessageEvent) => void) => {
			listeners.delete(listener);
		}),
		postMessage: vi.fn()
	};
	return {
		worker,
		emit: (data: unknown) => listeners.forEach((listener) => listener({ data } as MessageEvent))
	};
};

afterEach(() => {
	vi.useRealTimers();
});

describe('readPyodideWorkerFile', () => {
	it('aborts a pending read, removes its listener, and ignores the stale worker reply', async () => {
		vi.useFakeTimers();
		const { worker, emit } = createWorker();
		const controller = new AbortController();
		const read = readPyodideWorkerFile(worker, '/workspace/large.pdf', 1024, controller.signal);
		const [[{ id }]] = worker.postMessage.mock.calls;

		controller.abort();

		await expect(read).rejects.toMatchObject({ name: 'AbortError' });
		expect(worker.removeEventListener).toHaveBeenCalledTimes(1);
		expect(vi.getTimerCount()).toBe(0);
		emit({ id, data: new ArrayBuffer(8) });
		expect(worker.removeEventListener).toHaveBeenCalledTimes(1);
	});

	it('cleans up only once when a worker reply wins the race', async () => {
		vi.useFakeTimers();
		const { worker, emit } = createWorker();
		const controller = new AbortController();
		const read = readPyodideWorkerFile(worker, '/workspace/brief.docx', 1024, controller.signal);
		const [[{ id }]] = worker.postMessage.mock.calls;

		const data = new ArrayBuffer(3);
		emit({ id, data });
		expect(worker.removeEventListener).toHaveBeenCalledTimes(1);

		await expect(read).resolves.toBe(data);
		controller.abort();
		vi.advanceTimersByTime(30000);
		expect(worker.removeEventListener).toHaveBeenCalledTimes(1);
	});

	it('cleans up a timed-out read and rejects it once', async () => {
		vi.useFakeTimers();
		const { worker } = createWorker();
		const read = readPyodideWorkerFile(
			worker,
			'/workspace/deck.pptx',
			1024,
			new AbortController().signal
		);

		vi.advanceTimersByTime(30000);

		await expect(read).rejects.toThrow('File request timed out');
		expect(worker.removeEventListener).toHaveBeenCalledTimes(1);
	});
});
