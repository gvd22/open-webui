import { afterEach, describe, expect, it, vi } from 'vitest';

import {
	assertDocumentSize,
	DOCUMENT_TOO_LARGE_ERROR,
	normalizePyodideReadError,
	readPyodideWorkerFile
} from './pyodideFileRead';
import { PYODIDE_QUEUE_TIMEOUT_MS } from '$lib/pyodide/runtimeTimeouts';

const createWorker = () => {
	const listeners = {
		message: new Set<(event: MessageEvent) => void>(),
		error: new Set<(event: ErrorEvent) => void>()
	};
	const worker = {
		addEventListener: vi.fn((type: 'message' | 'error', listener: (event: any) => void) => {
			listeners[type].add(listener);
		}),
		removeEventListener: vi.fn((type: 'message' | 'error', listener: (event: any) => void) => {
			listeners[type].delete(listener);
		}),
		postMessage: vi.fn()
	};
	return {
		worker,
		emit: (data: unknown) =>
			listeners.message.forEach((listener) => listener({ data } as MessageEvent)),
		fail: (message: string) =>
			listeners.error.forEach((listener) => listener({ message } as ErrorEvent))
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
		expect(worker.removeEventListener).toHaveBeenCalledTimes(2);
		expect(vi.getTimerCount()).toBe(0);
		emit({ id, data: new ArrayBuffer(8) });
		expect(worker.removeEventListener).toHaveBeenCalledTimes(2);
	});

	it('cleans up only once when a worker reply wins the race', async () => {
		vi.useFakeTimers();
		const { worker, emit } = createWorker();
		const controller = new AbortController();
		const read = readPyodideWorkerFile(worker, '/workspace/brief.docx', 1024, controller.signal);
		const [[{ id }]] = worker.postMessage.mock.calls;

		const data = new ArrayBuffer(3);
		emit({ id, data });
		expect(worker.removeEventListener).toHaveBeenCalledTimes(2);

		await expect(read).resolves.toBe(data);
		controller.abort();
		vi.advanceTimersByTime(PYODIDE_QUEUE_TIMEOUT_MS);
		expect(worker.removeEventListener).toHaveBeenCalledTimes(2);
	});

	it('rejects immediately and cleans up when the worker crashes', async () => {
		vi.useFakeTimers();
		const { worker, fail } = createWorker();
		const read = readPyodideWorkerFile(
			worker,
			'/workspace/deck.pptx',
			1024,
			new AbortController().signal
		);

		fail('Worker crashed');

		await expect(read).rejects.toThrow('Worker crashed');
		expect(vi.getTimerCount()).toBe(0);
		expect(worker.removeEventListener).toHaveBeenCalledWith('message', expect.any(Function));
		expect(worker.removeEventListener).toHaveBeenCalledWith('error', expect.any(Function));
	});

	it('ignores worker progress until the file response arrives', async () => {
		const { worker, emit } = createWorker();
		const read = readPyodideWorkerFile(
			worker,
			'/workspace/deck.pptx',
			1024,
			new AbortController().signal
		);
		const [[{ id }]] = worker.postMessage.mock.calls;

		emit({ id, type: 'pyodide:progress', stage: 'request-started' });
		expect(worker.removeEventListener).not.toHaveBeenCalled();

		const data = new ArrayBuffer(3);
		emit({ id, type: 'fs:read', data });
		await expect(read).resolves.toBe(data);
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

		vi.advanceTimersByTime(PYODIDE_QUEUE_TIMEOUT_MS);

		await expect(read).rejects.toThrow('File request timed out');
		expect(worker.removeEventListener).toHaveBeenCalledTimes(2);
	});

	it('normalizes the worker size-limit error to the viewer error code', () => {
		expect(normalizePyodideReadError('File exceeds the read limit').message).toBe(
			DOCUMENT_TOO_LARGE_ERROR
		);
		expect(normalizePyodideReadError(new Error('File exceeds the read limit')).message).toBe(
			DOCUMENT_TOO_LARGE_ERROR
		);
	});

	it('maps a worker size-limit reply to the viewer error code', async () => {
		const { worker, emit } = createWorker();
		const read = readPyodideWorkerFile(
			worker,
			'/workspace/large.pdf',
			1024,
			new AbortController().signal
		);
		const [[{ id }]] = worker.postMessage.mock.calls;

		emit({ id, error: 'File exceeds the read limit' });

		await expect(read).rejects.toThrow(DOCUMENT_TOO_LARGE_ERROR);
	});

	it('uses the same viewer error code for a defensive post-read size check', () => {
		expect(() => assertDocumentSize(new ArrayBuffer(1025), 1024)).toThrow(DOCUMENT_TOO_LARGE_ERROR);
		expect(assertDocumentSize(new ArrayBuffer(1024), 1024).byteLength).toBe(1024);
	});
});
