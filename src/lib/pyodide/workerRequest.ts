import { getPyodideRequestTimeout } from './runtimeTimeouts';

export type PyodideFileRequest = {
	type: `fs:${string}`;
	[key: string]: unknown;
};

export type PyodideRequestWorker = Pick<
	Worker,
	'addEventListener' | 'removeEventListener' | 'postMessage'
>;

export const requestPyodideFile = <T = Record<string, any>>(
	worker: PyodideRequestWorker,
	message: PyodideFileRequest,
	options: {
		signal?: AbortSignal;
		onProgress?: (stage: string) => void;
		onTimeout?: () => void;
		onWorkerError?: () => void;
	} = {}
): Promise<T> =>
	new Promise((resolve, reject) => {
		const { signal, onProgress, onTimeout } = options;
		if (signal?.aborted) {
			reject(new DOMException('The operation was aborted.', 'AbortError'));
			return;
		}
		const id = `workspace-fs-${crypto.randomUUID()}`;
		let timer: ReturnType<typeof setTimeout>;
		const cleanup = () => {
			clearTimeout(timer);
			worker.removeEventListener('message', onMessage);
			worker.removeEventListener('error', onError);
			signal?.removeEventListener('abort', abort);
		};
		const abort = () => {
			cleanup();
			reject(new DOMException('The operation was aborted.', 'AbortError'));
		};
		const armTimeout = (stage: unknown) => {
			clearTimeout(timer);
			timer = setTimeout(() => {
				cleanup();
				reject(new Error('File request timed out'));
				onTimeout?.();
			}, getPyodideRequestTimeout(stage));
		};
		const onMessage = (event: MessageEvent) => {
			if (event.data?.id !== id) return;
			if (event.data.type === 'pyodide:progress') {
				armTimeout(event.data.stage);
				onProgress?.(event.data.stage);
				return;
			}
			if (event.data.type !== message.type) return;
			cleanup();
			if (event.data.error || event.data.stderr)
				reject(new Error(event.data.error || event.data.stderr));
			else resolve(event.data);
		};
		const onError = (event: ErrorEvent) => {
			cleanup();
			reject(event.error || new Error(event.message || 'Pyodide worker failed'));
			options.onWorkerError?.();
		};
		worker.addEventListener('message', onMessage);
		worker.addEventListener('error', onError);
		signal?.addEventListener('abort', abort, { once: true });
		armTimeout('request-queued');
		try {
			worker.postMessage({ ...message, id });
		} catch (error) {
			cleanup();
			reject(error);
		}
	});
