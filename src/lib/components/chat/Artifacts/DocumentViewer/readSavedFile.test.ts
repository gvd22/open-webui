import { afterEach, expect, it, vi } from 'vitest';
import { readSavedFile } from './readSavedFile';

afterEach(() => {
	vi.unstubAllGlobals();
});

it('cancels oversized headers before reading bytes', async () => {
	const cancel = vi.fn();
	vi.stubGlobal(
		'fetch',
		vi
			.fn()
			.mockResolvedValue(
				new Response(new ReadableStream({ cancel }), { headers: { 'Content-Length': '100' } })
			)
	);
	await expect(readSavedFile('large', 10, new AbortController().signal)).rejects.toThrow(
		'too-large'
	);
	expect(cancel).toHaveBeenCalledOnce();
});

it('bounds streams without trusting their length header', async () => {
	const cancel = vi.fn();
	vi.stubGlobal(
		'fetch',
		vi.fn().mockResolvedValue(
			new Response(
				new ReadableStream({
					start(controller) {
						controller.enqueue(new Uint8Array(11));
					},
					cancel
				}),
				{ headers: { 'Content-Length': '1' } }
			)
		)
	);
	await expect(readSavedFile('large', 10, new AbortController().signal)).rejects.toThrow(
		'too-large'
	);
	expect(cancel).toHaveBeenCalledOnce();
});

it('keeps credentials and cancellation and returns the exact bytes', async () => {
	const fetcher = vi.fn().mockResolvedValue(new Response('abc'));
	vi.stubGlobal('fetch', fetcher);
	const signal = new AbortController().signal;
	expect(new TextDecoder().decode(await readSavedFile('safe/id', 3, signal))).toBe('abc');
	expect(fetcher).toHaveBeenCalledWith(expect.stringContaining('safe%2Fid/content'), {
		credentials: 'include',
		signal
	});
});
