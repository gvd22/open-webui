import { WEBUI_API_BASE_URL } from '$lib/constants';
import { DOCUMENT_TOO_LARGE_ERROR } from './pyodideFileRead';

export const readSavedFile = async (id: string, maxBytes: number, signal: AbortSignal) => {
	const response = await fetch(`${WEBUI_API_BASE_URL}/files/${encodeURIComponent(id)}/content`, {
		credentials: 'include',
		signal
	});
	if (!response.ok) throw new Error(response.status === 404 ? 'missing' : 'unavailable');
	if (Number(response.headers.get('Content-Length')) > maxBytes) {
		await response.body?.cancel();
		throw new Error(DOCUMENT_TOO_LARGE_ERROR);
	}
	if (!response.body) throw new Error('missing');
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let size = 0;
	try {
		while (true) {
			const { value, done } = await reader.read();
			if (done) break;
			size += value.byteLength;
			if (size > maxBytes) {
				await reader.cancel();
				throw new Error(DOCUMENT_TOO_LARGE_ERROR);
			}
			chunks.push(value);
		}
	} finally {
		reader.releaseLock();
	}
	const result = new Uint8Array(size);
	let offset = 0;
	for (const chunk of chunks) {
		result.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return result.buffer;
};
