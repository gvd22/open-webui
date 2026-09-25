import { requestPyodideFile, type PyodideRequestWorker } from '$lib/pyodide/workerRequest';

export const DOCUMENT_TOO_LARGE_ERROR = 'too-large';

const PYODIDE_READ_LIMIT_ERROR = 'File exceeds the read limit';

export const normalizePyodideReadError = (cause: unknown): Error => {
	const message = cause instanceof Error ? cause.message : String(cause);
	return new Error(message === PYODIDE_READ_LIMIT_ERROR ? DOCUMENT_TOO_LARGE_ERROR : message);
};

export const assertDocumentSize = (data: ArrayBuffer, maxBytes: number): ArrayBuffer => {
	if (data.byteLength > maxBytes) throw new Error(DOCUMENT_TOO_LARGE_ERROR);
	return data;
};

export const readPyodideWorkerFile = async (
	worker: PyodideRequestWorker,
	path: string,
	maxBytes: number,
	signal: AbortSignal
): Promise<ArrayBuffer> => {
	try {
		const { data: bytes } = await requestPyodideFile<{ data: ArrayBuffer | ArrayBufferView }>(
			worker,
			{ type: 'fs:read', path, maxBytes },
			{ signal }
		);
		if (bytes instanceof ArrayBuffer) return assertDocumentSize(bytes, maxBytes);
		if (ArrayBuffer.isView(bytes))
			return assertDocumentSize(
				bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
				maxBytes
			);
		throw new Error('File data was not returned');
	} catch (error) {
		if (error instanceof DOMException && error.name === 'AbortError') throw error;
		throw normalizePyodideReadError(error);
	}
};
