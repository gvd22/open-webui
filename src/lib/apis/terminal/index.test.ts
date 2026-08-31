import { afterEach, describe, expect, it, vi } from 'vitest';

import {
	archiveFromTerminal,
	createDirectory,
	deleteEntry,
	downloadFileBlob,
	downloadFileBlobDetailed,
	getListeningPorts,
	getTerminalServers,
	moveEntry,
	uploadToTerminal
} from './index';

describe('getListeningPorts', () => {
		afterEach(() => {
			vi.unstubAllGlobals();
		});

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

describe('managed Terminal catalog', () => {
		afterEach(() => {
			vi.unstubAllGlobals();
		});

	it('keeps legacy callers tolerant but lets runtime selection preserve an unknown catalog', async () => {
		vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));

		await expect(getTerminalServers('token')).resolves.toEqual([]);
		await expect(getTerminalServers('token', { throwOnError: true })).rejects.toThrow('offline');
	});
});

describe('Terminal file session headers', () => {
		afterEach(() => {
			vi.unstubAllGlobals();
		});

	it('scopes create, upload, archive, delete, download, save, and move operations to the chat', async () => {
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			headers: { get: vi.fn().mockReturnValue(null) },
			json: vi.fn().mockResolvedValue({}),
			blob: vi.fn().mockResolvedValue(new Blob(['data']))
		});
		vi.stubGlobal('fetch', fetchMock);

		const file = new File(['content'], 'file.txt', { type: 'text/plain' });
		await createDirectory('/terminal', 'token', '/workspace/new', 'chat-1');
		await uploadToTerminal('/terminal', 'token', '/workspace', file, 'chat-1');
		await archiveFromTerminal('/terminal', 'token', ['/workspace/new'], 'chat-1');
		await deleteEntry('/terminal', 'token', '/workspace/old', 'chat-1');
		await downloadFileBlob('/terminal', 'token', '/workspace/file.txt', 'chat-1');
		await uploadToTerminal('/terminal', 'token', '/workspace', file, 'chat-1');
		await moveEntry('/terminal', 'token', '/workspace/a', '/workspace/b', 'chat-1');

		expect(fetchMock).toHaveBeenCalledTimes(7);
		for (const [, options] of fetchMock.mock.calls) {
			expect(options.headers).toMatchObject({
				Authorization: 'Bearer token',
				'X-Session-Id': 'chat-1'
			});
		}
	});
});

describe('downloadFileBlob', () => {
		afterEach(() => {
			vi.unstubAllGlobals();
		});

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

	it('keeps a streamed subarray within its exact byte range', async () => {
		const source = new Uint8Array([9, 1, 2, 3, 9]);
		const body = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(source.subarray(1, 4));
				controller.close();
			}
		});
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body)));

		const result = await downloadFileBlob('/terminal', 'token', '/range.pdf', undefined, 8);
		expect([...new Uint8Array(await result!.blob.arrayBuffer())]).toEqual([1, 2, 3]);
	});

	it('distinguishes a missing file from an unavailable terminal for viewer recovery', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 404 })));
		await expect(downloadFileBlobDetailed('/terminal', 'token', '/gone.pdf')).resolves.toEqual({
			ok: false,
			reason: 'missing'
		});

		vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
		await expect(downloadFileBlobDetailed('/terminal', 'token', '/report.pdf')).resolves.toEqual({
			ok: false,
			reason: 'unavailable'
		});
	});

	it('sends only the established authentication and session headers for viewer downloads', async () => {
		const fetchMock = vi.fn().mockResolvedValue(new Response(new Uint8Array([1])));
		vi.stubGlobal('fetch', fetchMock);

		await downloadFileBlobDetailed('/terminal', ' token ', '/report.pdf', 'session-1', 8);

		expect(fetchMock.mock.calls[0][1]?.headers).toEqual({
			Authorization: 'Bearer token',
			'X-Session-Id': 'session-1'
		});
	});
});
