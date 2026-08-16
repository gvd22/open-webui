type PyodideFileWorker = {
	addEventListener: (type: 'message', listener: (event: MessageEvent) => void) => void;
	removeEventListener: (type: 'message', listener: (event: MessageEvent) => void) => void;
	postMessage: (message: { type: 'fs:read'; path: string; id: string; maxBytes: number }) => void;
};

const createAbortError = () => new DOMException('The operation was aborted.', 'AbortError');

export const readPyodideWorkerFile = (
	worker: PyodideFileWorker,
	path: string,
	maxBytes: number,
	signal: AbortSignal
): Promise<ArrayBuffer> => {
	const id = `document-viewer-${crypto.randomUUID()}`;
	return new Promise((resolve, reject) => {
		if (signal.aborted) {
			reject(createAbortError());
			return;
		}

		let settled = false;
		let timeout: ReturnType<typeof setTimeout> | null = null;
		const cleanup = () => {
			if (settled) return false;
			settled = true;
			if (timeout !== null) globalThis.clearTimeout(timeout);
			worker.removeEventListener('message', handler);
			signal.removeEventListener('abort', abort);
			return true;
		};
		const abort = () => {
			if (cleanup()) reject(createAbortError());
		};
		const handler = (event: MessageEvent) => {
			if (event.data?.id !== id || !cleanup()) return;
			if (event.data?.error) {
				reject(new Error(event.data.error));
				return;
			}
			const bytes = event.data?.data;
			if (bytes instanceof ArrayBuffer) resolve(bytes);
			else if (ArrayBuffer.isView(bytes)) {
				resolve(
					bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
				);
			} else reject(new Error('File data was not returned'));
		};

		worker.addEventListener('message', handler);
		signal.addEventListener('abort', abort, { once: true });
		timeout = globalThis.setTimeout(() => {
			if (cleanup()) reject(new Error('File request timed out'));
		}, 30000);
		try {
			worker.postMessage({ type: 'fs:read', path, id, maxBytes });
		} catch (cause) {
			if (cleanup()) reject(cause);
		}
	});
};
