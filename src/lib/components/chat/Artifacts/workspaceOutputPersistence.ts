import { get } from 'svelte/store';
import {
	chatId,
	user,
	pyodideWorker,
	workspaceOutputFiles,
	workspaceOutputSaveStates,
	type WorkspaceOutputFile
} from '$lib/stores';
import { deleteFileById, uploadFile } from '$lib/apis/files';
import { isTemporaryChatId } from '$lib/utils/chatId';
import { readPyodideWorkerFile } from './DocumentViewer/pyodideFileRead';
import {
	createWorkspaceOutputCatalog,
	createWorkspaceOutputFile,
	isWorkspaceOutputPath,
	parseWorkspaceOutputSnapshots,
	resolveWorkspaceOutputFile
} from './workspaceOutputs';

export type UploadedWorkspaceFile = {
	id: string;
	meta?: { content_type?: string; size?: number };
};

export const createWorkspaceOutputPersistence = (
	workspaceOutputCatalog: ReturnType<typeof createWorkspaceOutputCatalog>,
	onSaved: (file: WorkspaceOutputFile, uploaded: UploadedWorkspaceFile) => void,
	onError: () => void
) => {
	const outputSnapshotQueue = new Map<string, Promise<void>>();
	const outputSnapshotVersions = new Map<string, number>();
	const setSaveState = (key: string, version: number, state?: 'saving' | 'failed') => {
		if (outputSnapshotVersions.get(key) !== version) return;
		workspaceOutputSaveStates.update((states) => {
			const next = { ...states };
			if (state) next[key] = state;
			else delete next[key];
			return next;
		});
	};
	type PyodideFilesEventDetail = {
		chatId?: string;
		kind?: string;
		messageId?: string;
		paths?: unknown[];
		snapshots?: unknown[];
	};
	const outputMimeTypes: Record<string, string> = {
		csv: 'text/csv',
		doc: 'application/msword',
		docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
		ods: 'application/vnd.oasis.opendocument.spreadsheet',
		odt: 'application/vnd.oasis.opendocument.text',
		pdf: 'application/pdf',
		ppt: 'application/vnd.ms-powerpoint',
		pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
		xls: 'application/vnd.ms-excel',
		xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
	};

	const persistPyodideOutputSnapshot = async (
		chatContextId: string,
		path: string,
		messageId: string | undefined,
		expectedVersion: number,
		snapshotData?: ArrayBuffer,
		allowRuntimeRead = true
	) => {
		const key = `${chatContextId}\u0000${path}`;
		const extension = path.split('.').pop()?.toLowerCase() ?? '';
		const contentType = outputMimeTypes[extension] ?? 'application/octet-stream';
		let data = snapshotData;
		if (data === undefined) {
			if (!allowRuntimeRead) {
				throw new Error('The execution-time output snapshot is unavailable.');
			}
			const worker = get(pyodideWorker);
			if (!worker) throw new Error('Code Interpreter is no longer available.');
			data = await readPyodideWorkerFile(
				worker,
				path,
				64 * 1024 * 1024,
				new AbortController().signal
			);
		}
		if (outputSnapshotVersions.get(key) !== expectedVersion) return;
		const name = path.split('/').filter(Boolean).at(-1) || `output.${extension || 'bin'}`;
		const uploadedFile = await uploadFile(
			localStorage.token,
			new File([data], name, { type: contentType }),
			{
				source: 'workspace-output',
				origin_chat_id: chatContextId,
				origin_message_id: messageId ?? null,
				workspace_path: path
			},
			true,
			true
		);
		if (!uploadedFile) throw new Error('Workspace output upload returned no file.');
		if (outputSnapshotVersions.get(key) !== expectedVersion) {
			await deleteFileById(localStorage.token, uploadedFile.id).catch((error) => {
				console.warn('Obsolete workspace output snapshot could not be removed', error);
			});
			return;
		}
		const previous =
			get(chatId) === chatContextId
				? resolveWorkspaceOutputFile(get(workspaceOutputFiles), path)
				: null;
		const savedAt = Date.now();
		const output = createWorkspaceOutputFile(path, {
			fileId: uploadedFile.id,
			messageId: messageId ?? previous?.messageId,
			originChatId: chatContextId,
			contentType: uploadedFile.meta?.content_type ?? contentType,
			size: uploadedFile.meta?.size ?? data.byteLength,
			persistedAt: savedAt,
			updatedAt: savedAt
		});
		if (!output) return;
		workspaceOutputCatalog.record(chatContextId, path, output, {
			onConfirmed: () => {
				setSaveState(key, expectedVersion);
				if (get(chatId) === chatContextId && outputSnapshotVersions.get(key) === expectedVersion) {
					onSaved(output, uploadedFile);
				}
			},
			onFailed: (error) => {
				setSaveState(key, expectedVersion, 'failed');
				const status =
					error && typeof error === 'object' && 'status' in error
						? Number((error as { status?: unknown }).status)
						: NaN;
				if (!Number.isInteger(status) || status < 400 || status >= 500 || status === 408) {
					console.warn(
						'Workspace output upload retained because persistence outcome is unknown',
						error
					);
					return;
				}
				deleteFileById(localStorage.token, uploadedFile.id).catch((error) => {
					console.warn('Unattached workspace output snapshot could not be removed', error);
				});
			}
		});
	};

	const queuePyodideOutputSnapshot = (
		chatContextId: string,
		path: string,
		messageId: string | undefined,
		expectedVersion: number,
		snapshotData?: ArrayBuffer,
		allowRuntimeRead = true
	) => {
		const key = `${chatContextId}\u0000${path}`;
		const previous = outputSnapshotQueue.get(key) ?? Promise.resolve();
		const next = previous
			.catch(() => {})
			.then(() =>
				persistPyodideOutputSnapshot(
					chatContextId,
					path,
					messageId,
					expectedVersion,
					snapshotData,
					allowRuntimeRead
				)
			)
			.catch((error) => {
				setSaveState(key, expectedVersion, 'failed');
				console.error('Workspace output snapshot could not be saved', error);
				if (get(chatId) === chatContextId) {
					onError();
				}
			})
			.finally(() => {
				if (outputSnapshotQueue.get(key) === next) {
					outputSnapshotQueue.delete(key);
				}
			});
		outputSnapshotQueue.set(key, next);
	};

	const schedulePyodideOutputSnapshot = (
		chatContextId: string,
		path: string,
		messageId?: string,
		deleted = false,
		snapshotData?: ArrayBuffer,
		allowRuntimeRead = true
	) => {
		const key = `${chatContextId}\u0000${path}`;
		const version = (outputSnapshotVersions.get(key) ?? 0) + 1;
		outputSnapshotVersions.set(key, version);
		if (!deleted) {
			setSaveState(key, version, 'saving');
			queuePyodideOutputSnapshot(
				chatContextId,
				path,
				messageId,
				version,
				snapshotData,
				allowRuntimeRead
			);
		} else {
			setSaveState(key, version);
		}
	};

	const handlePyodideFilesChanged = (event: Event) => {
		const detail = (event as CustomEvent<PyodideFilesEventDetail>)?.detail ?? {};
		const activeChatId = get(chatId) ?? '';
		const chatContextId = detail?.chatId || activeChatId;
		if (!chatContextId || isTemporaryChatId(chatContextId)) return;
		workspaceOutputCatalog.applyPyodideChange(chatContextId, detail);
		const snapshots = parseWorkspaceOutputSnapshots(detail?.snapshots);
		const canPersist =
			get(user)?.role === 'admin' || (get(user)?.permissions?.chat?.file_upload ?? true);
		for (const path of (Array.isArray(detail?.paths) ? detail.paths : []).filter(
			isWorkspaceOutputPath
		)) {
			if (detail?.kind !== 'deleted' && !canPersist) continue;
			schedulePyodideOutputSnapshot(
				chatContextId,
				path,
				detail?.messageId,
				detail?.kind === 'deleted',
				snapshots.files.get(path),
				!snapshots.atomic
			);
		}
	};

	return { schedule: schedulePyodideOutputSnapshot, handleChange: handlePyodideFilesChanged };
};
