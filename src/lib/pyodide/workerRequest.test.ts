import { afterEach, expect, it, vi } from 'vitest';
import { requestPyodideFile } from './workerRequest';
import { PYODIDE_QUEUE_TIMEOUT_MS } from './runtimeTimeouts';

afterEach(() => {
	vi.useRealTimers();
});

it('isolates overlapping exports, ignores unrelated replies and cleans up after abort', async () => {
	vi.useFakeTimers();
	const worker = Object.assign(new EventTarget(), { postMessage: vi.fn() }) as unknown as Worker;
	const reply = (data: object) => worker.dispatchEvent(new MessageEvent('message', { data }));
	const oldController = new AbortController();
	const old = requestPyodideFile(
		worker,
		{ type: 'fs:mkdir', path: '/first' },
		{ signal: oldController.signal }
	);
	const current = requestPyodideFile(worker, { type: 'fs:upload', files: [] });
	const [{ id: oldId }, { id }] = vi
		.mocked(worker.postMessage)
		.mock.calls.map(([message]) => message);
	expect(id).not.toBe(oldId);
	let complete = false;
	void current.then(() => {
		complete = true;
	});
	reply({ id, type: 'fs:mkdir', success: true });
	reply({ id: oldId, type: 'fs:mkdir', success: true });
	await old;
	await Promise.resolve();
	expect(complete).toBe(false);
	oldController.abort();
	reply({ id, type: 'fs:upload', success: true });
	await expect(current).resolves.toMatchObject({ success: true });
	expect(vi.getTimerCount()).toBe(0);

	const controller = new AbortController();
	const remove = vi.spyOn(worker, 'removeEventListener');
	const aborted = requestPyodideFile(worker, { type: 'fs:read' }, { signal: controller.signal });
	controller.abort();
	await expect(aborted).rejects.toMatchObject({ name: 'AbortError' });
	expect(remove).toHaveBeenCalledTimes(2);
	expect(vi.getTimerCount()).toBe(0);
});

it('does not post when already aborted and cleans up before timing out', async () => {
	vi.useFakeTimers();
	const worker = Object.assign(new EventTarget(), { postMessage: vi.fn() }) as unknown as Worker;
	await expect(
		requestPyodideFile(worker, { type: 'fs:read' }, { signal: AbortSignal.abort() })
	).rejects.toMatchObject({ name: 'AbortError' });
	expect(worker.postMessage).not.toHaveBeenCalled();
	const onTimeout = vi.fn();
	const pending = requestPyodideFile(worker, { type: 'fs:read' }, { onTimeout });
	vi.advanceTimersByTime(PYODIDE_QUEUE_TIMEOUT_MS);
	await expect(pending).rejects.toThrow('timed out');
	expect(onTimeout).toHaveBeenCalledOnce();
	expect(vi.getTimerCount()).toBe(0);
});
