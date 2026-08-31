import { requirePyodideWorkspacePath } from './workspace';

export const decodeRuntimeText = (buffer: BufferSource): string => {
	try {
		return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
	} catch {
		throw new Error('Only UTF-8 text files can be imported into a Web Preview.');
	}
};

export const readWorkspaceText = (
	worker: Worker, id: string, path: string, maxBytes: number
): Promise<string> => {
	path = requirePyodideWorkspacePath(path);
	return new Promise((resolve, reject) => {
		const cleanup = () => {
			clearTimeout(timeout);
			worker.removeEventListener('message', onMessage);
		};
		const onMessage = (event: MessageEvent) => {
			if (event.data?.id !== id || event.data?.type !== 'fs:read') return;
			cleanup();
			try {
				if (event.data.error) throw new Error(event.data.error);
				resolve(decodeRuntimeText(event.data.data));
			} catch (error) {
				reject(error);
			}
		};
		const timeout = setTimeout(() => {
			cleanup();
			reject(new Error('Pyodide timed out while reading the file.'));
		}, 30000);
		worker.addEventListener('message', onMessage);
		try {
			worker.postMessage({ type: 'fs:read', id, path, maxBytes });
		} catch (error) {
			cleanup();
			reject(error);
		}
	});
};
