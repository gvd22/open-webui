export const PYODIDE_QUEUE_TIMEOUT_MS = 15 * 60 * 1000;
export const PYODIDE_PREPARE_TIMEOUT_MS = 5 * 60 * 1000;
export const PYODIDE_EXECUTION_TIMEOUT_MS = 60 * 1000;

export const getPyodideRequestTimeout = (stage: unknown) =>
	stage === 'request-queued'
		? PYODIDE_QUEUE_TIMEOUT_MS
		: stage === 'executing-code'
			? PYODIDE_EXECUTION_TIMEOUT_MS
			: PYODIDE_PREPARE_TIMEOUT_MS;

export type PyodideTerminationEvent = Event & {
	message: string;
	pyodideTerminating: true;
};

export const terminatePyodideWorker = (worker: Worker, message: string) => {
	const event = new Event('error') as PyodideTerminationEvent;
	Object.defineProperties(event, {
		message: { value: message, enumerable: true },
		pyodideTerminating: { value: true, enumerable: true }
	});
	worker.dispatchEvent(event);
	worker.terminate();
};
