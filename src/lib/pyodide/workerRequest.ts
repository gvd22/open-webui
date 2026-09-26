import { getPyodideRequestTimeout, terminatePyodideWorker } from './runtimeTimeouts';

export type PyodideFileRequest = {
	type: `fs:${string}`;
	[key: string]: unknown;
};

export type PyodideRequestWorker = Pick<
	Worker,
	'addEventListener' | 'removeEventListener' | 'postMessage'
>;

const requestPyodide = <T = Record<string, any>>(
	worker: PyodideRequestWorker,
	message:
		| PyodideFileRequest
		| {
				type: 'execute';
				code: string;
				packages: string[];
				files?: { name: string; data: ArrayBuffer }[];
		  },
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
			if (event.data.type && event.data.type !== message.type) return;
			cleanup();
			if (event.data.error || (message.type !== 'execute' && event.data.stderr))
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

export const requestPyodideFile = <T = Record<string, any>>(
	worker: PyodideRequestWorker,
	message: PyodideFileRequest,
	options: Parameters<typeof requestPyodide>[2] = {}
) => requestPyodide<T>(worker, message, options);

export const executePyodide = (
	worker: Worker,
	message: { code: string; packages: string[]; files?: { name: string; data: ArrayBuffer }[] },
	onWorkerError: () => void
) =>
	requestPyodide<{ stdout?: string; stderr?: string; result?: unknown }>(
		worker,
		{ ...message, type: 'execute' },
		{
			onWorkerError,
			onTimeout: () => {
				terminatePyodideWorker(worker, 'Execution Time Limit Exceeded');
				onWorkerError();
			}
		}
	);
