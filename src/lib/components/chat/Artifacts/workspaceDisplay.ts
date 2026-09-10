import { get } from 'svelte/store';
import {
	chatId,
	config,
	user,
	pyodideWorker,
	workspaceOutputFiles,
	showControls,
	showFileNavPath,
	showArtifacts
} from '$lib/stores';
import { getFileById } from '$lib/apis/files';
import { displayFileHandler } from '$lib/utils';
import { readPyodideWorkerFile } from './DocumentViewer/pyodideFileRead';
import {
	hasNewerWorkspaceOutputVersion,
	isWorkspaceOutputPath,
	resolveWorkspaceOutputFile
} from './workspaceOutputs';
import { isWorkspaceDocumentPath } from './workspace';

export const displayWorkspaceOutput = async (targetChatId: string, path: unknown) => {
	if (!targetChatId || get(chatId) !== targetChatId)
		throw new Error('The chat is no longer active.');
	const currentUser = get(user);
	if (
		get(config)?.features?.enable_document_viewer !== true ||
		get(config)?.features?.enable_code_interpreter !== true ||
		get(config)?.code?.interpreter_engine !== 'pyodide' ||
		(currentUser?.role !== 'admin' && currentUser?.permissions?.features?.code_interpreter !== true)
	) {
		throw new Error('Pyodide document display is disabled.');
	}
	if (!isWorkspaceOutputPath(path)) throw new Error('Invalid document path.');
	if (!isWorkspaceDocumentPath(path))
		throw new Error('This format is download-only. Use an output link instead.');
	const file = resolveWorkspaceOutputFile(get(workspaceOutputFiles), path);
	if (!file || (file.originChatId && file.originChatId !== targetChatId)) {
		throw new Error('This document is not an output of the active chat.');
	}
	const fileId = hasNewerWorkspaceOutputVersion(file) ? undefined : file.fileId;
	if (fileId) {
		if (!(await getFileById(localStorage.token, fileId)))
			throw new Error('The saved file is unavailable.');
	} else {
		const worker = get(pyodideWorker);
		if (!worker)
			throw new Error('The browser file is unavailable. Save or regenerate the document first.');
		await readPyodideWorkerFile(worker, path, 64 * 1024 * 1024, new AbortController().signal);
	}
	if (
		get(chatId) !== targetChatId ||
		resolveWorkspaceOutputFile(get(workspaceOutputFiles), path)?.updatedAt !== file.updatedAt
	) {
		throw new Error('The chat or document changed. Select the current output again.');
	}
	displayFileHandler(
		path,
		{ showControls, showFileNavPath, showArtifacts },
		{ fileId, chatId: targetChatId }
	);
	return { status: 'opening', path };
};
