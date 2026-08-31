import { afterEach, describe, expect, it, vi } from 'vitest';
import { readWorkspaceText } from './readWorkspaceText';

describe('runtime snapshot reads', () => {
	afterEach(() => {
		vi.useRealTimers();
	});
	const worker = () => Object.assign(new EventTarget(), { postMessage: vi.fn() }) as unknown as Worker;
	const reply = (target: Worker, data: Uint8Array) => target.dispatchEvent(
		new MessageEvent('message', { data: { id: 'read', type: 'fs:read', data } })
	);
	it('rejects invalid UTF-8 promptly and releases its listener and timer', async () => {
		vi.useFakeTimers();
		const target = worker();
		const remove = vi.spyOn(target, 'removeEventListener');
		const pending = readWorkspaceText(target, 'read', '/mnt/uploads/data.csv', 512000);
		reply(target, new Uint8Array([0xff]));
		await expect(pending).rejects.toThrow('UTF-8');
		expect(remove).toHaveBeenCalledOnce();
		expect(vi.getTimerCount()).toBe(0);
	});
	it('reads text and rejects paths outside the workspace', async () => {
		const target = worker();
		expect(() => readWorkspaceText(target, 'read', '/etc/secret', 512000)).toThrow('outside');
		const pending = readWorkspaceText(target, 'read', '/mnt/uploads/data.csv', 512000);
		reply(target, new TextEncoder().encode('name,value\nTest,42'));
		await expect(pending).resolves.toBe('name,value\nTest,42');
	});
	it('cleans up if the worker cannot accept a request', async () => {
		vi.useFakeTimers();
		const target = worker();
		vi.mocked(target.postMessage).mockImplementation(() => { throw new Error('Stopped'); });
		await expect(readWorkspaceText(target, 'read', '/mnt/uploads/a.csv', 10)).rejects.toThrow('Stopped');
		expect(vi.getTimerCount()).toBe(0);
	});
});
