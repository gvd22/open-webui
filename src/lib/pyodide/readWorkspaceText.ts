import { requirePyodideWorkspacePath } from './workspace';
import { requestPyodideFile } from './workerRequest';

export const decodeRuntimeText = (buffer: BufferSource): string => {
	try {
		return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
	} catch {
		throw new Error('Only UTF-8 text files can be imported into a Web Preview.');
	}
};

export const readWorkspaceText = (
	worker: Worker,
	path: string,
	maxBytes: number
): Promise<string> => {
	path = requirePyodideWorkspacePath(path);
	return requestPyodideFile<{ data: BufferSource }>(worker, {
		type: 'fs:read',
		path,
		maxBytes
	}).then(({ data }) => decodeRuntimeText(data));
};
