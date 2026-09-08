import { requirePyodideWorkspacePath } from './workspace';
import { getPyodideRequestTimeout } from './runtimeTimeouts';

export const decodeRuntimeText = (buffer: BufferSource): string => {
	try {
		return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
	} catch {
		throw new Error('Only UTF-8 text files can be imported into a Web Preview.');
	}
};

export const readWorkspaceText = (
	worker: Worker,
	id: string,
	path: string,
	maxBytes: number
): Promise<string> => {
	path = requirePyodideWorkspacePath(path);
	return new Promise((resolve, reject) => {
		let timeout: ReturnType<typeof setTimeout>;
		const armTimeout = (milliseconds: number) => {
			clearTimeout(timeout);
			timeout = setTimeout(() => {
				cleanup();
				reject(new Error('Pyodide timed out while reading the file.'));
			}, milliseconds);
		};
		const cleanup = () => {
			clearTimeout(timeout);
			worker.removeEventListener('message', onMessage);
			worker.removeEventListener('error', onError);
		};
		const onError = (event: ErrorEvent) => {
			cleanup();
			reject(event.error || new Error(event.message || 'Pyodide worker failed'));
		};
		const onMessage = (event: MessageEvent) => {
			if (event.data?.id !== id) return;
			if (event.data?.type === 'pyodide:progress') {
				armTimeout(getPyodideRequestTimeout(event.data.stage));
				return;
			}
			if (event.data?.type !== 'fs:read') return;
			cleanup();
			try {
				if (event.data.error) throw new Error(event.data.error);
				resolve(decodeRuntimeText(event.data.data));
			} catch (error) {
				reject(error);
			}
		};
		worker.addEventListener('message', onMessage);
		worker.addEventListener('error', onError);
		armTimeout(getPyodideRequestTimeout('request-queued'));
		try {
			worker.postMessage({ type: 'fs:read', id, path, maxBytes });
		} catch (error) {
			cleanup();
			reject(error);
		}
	});
};
