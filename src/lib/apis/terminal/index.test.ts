import { afterEach, describe, expect, it, vi } from 'vitest';

import { downloadFileBlob, getListeningPorts } from './index';

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

describe('downloadFileBlob', () => {
	afterEach(() => vi.unstubAllGlobals());

	it('rejects a response whose declared size exceeds the limit', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue(
				new Response(new Uint8Array(16), {
					headers: { 'content-length': '16', 'content-type': 'application/pdf' }
				})
			)
		);

		await expect(
			downloadFileBlob('/terminal', 'token', '/large.pdf', undefined, 8)
		).resolves.toBeNull();
	});

	it('cancels a chunked response as soon as the streamed size exceeds the limit', async () => {
		const body = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(new Uint8Array([1, 2, 3, 4]));
				controller.enqueue(new Uint8Array([5, 6, 7, 8]));
				controller.close();
			}
		});
		vi.stubGlobal(
			'fetch',
			vi
				.fn()
				.mockResolvedValue(new Response(body, { headers: { 'content-type': 'application/pdf' } }))
		);

		await expect(
			downloadFileBlob('/terminal', 'token', '/chunked.pdf', undefined, 6)
		).resolves.toBeNull();
	});

	it('returns a bounded streamed file with its original content type', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue(
				new Response(new Uint8Array([1, 2, 3, 4]), {
					headers: { 'content-length': '4', 'content-type': 'application/pdf' }
				})
			)
		);

		const result = await downloadFileBlob('/terminal', 'token', '/ok.pdf', undefined, 8);
		expect(result?.filename).toBe('ok.pdf');
		expect(result?.blob.size).toBe(4);
		expect(result?.blob.type).toBe('application/pdf');
	});
});
