import { afterEach, describe, expect, it, vi } from 'vitest';

import { getListeningPorts } from './index';

describe('getListeningPorts', () => {
	afterEach(() => vi.unstubAllGlobals());

	it('keeps legacy callers tolerant when the Terminal service is unavailable', async () => {
		vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));

		await expect(getListeningPorts('/api/v1/terminals/test', 'token')).resolves.toEqual([]);
	});

	it('lets the Workspace browser distinguish an unavailable service from no open ports', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 502 }));

		await expect(
			getListeningPorts('/api/v1/terminals/test', 'token', { throwOnError: true })
		).rejects.toThrow('Terminal ports request failed: 502');
	});

	it('returns the listening ports from a healthy service', async () => {
		const ports = [{ port: 8080, pid: 42, process: 'web' }];
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({ ok: true, json: vi.fn().mockResolvedValue({ ports }) })
		);

		await expect(
			getListeningPorts('/api/v1/terminals/test', 'token', { throwOnError: true })
		).resolves.toEqual(ports);
	});
});
