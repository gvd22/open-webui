import { get } from 'svelte/store';
import { selectTransientCanvasDocument, selectTransientWebPreview } from '$lib/apis/chats';
import {
	artifactCode,
	artifactContents,
	chatId,
	showArtifacts,
	showControls,
	showEmbeds,
	workspaceOpenRequestId
} from '$lib/stores';
import { mergePersistedCanvasArtifact, type CanvasNoteArtifact } from '../Artifacts/canvas';
import { mergePersistedWebPreview, type WebPreviewArtifact } from '../Artifacts/webPreview';
import type { WorkspaceContent } from '../Artifacts/workspace';

let openGeneration = 0;
export const cancelPendingWorkspaceOpen = () => {
	openGeneration += 1;
};

// Selecting a tab hydrates existing content; only an explicit card open may add it.
export const selectWorkspaceArtifact = async (
	artifact: WorkspaceContent,
	targetChatId: string,
	addIfMissing = false,
	isCurrent = () => true
): Promise<boolean> => {
	if (get(chatId) !== targetChatId || !isCurrent()) return false;
	let matches: (item: WorkspaceContent) => boolean;
	let merge: (item: WorkspaceContent) => WorkspaceContent;
	if (targetChatId && artifact.type === 'canvas-note' && artifact.canvasId) {
		const document = await selectTransientCanvasDocument(
			localStorage.token,
			targetChatId,
			artifact.canvasId
		);
		matches = (item) => item.type === 'canvas-note' && item.canvasId === artifact.canvasId;
		merge = (item) =>
			item.type === 'canvas-note'
				? mergePersistedCanvasArtifact(item, {
						...document,
						content_hash: document.contentHash
					})
				: item;
	} else if (
		targetChatId &&
		artifact.type === 'web-preview' &&
		artifact.previewId &&
		artifact.source === 'tool'
	) {
		const document = await selectTransientWebPreview(
			localStorage.token,
			targetChatId,
			artifact.previewId
		);
		matches = (item) => item.type === 'web-preview' && item.previewId === artifact.previewId;
		merge = (item) =>
			item.type === 'web-preview' ? mergePersistedWebPreview(item, document) : item;
	} else {
		return true;
	}
	if (get(chatId) !== targetChatId || !isCurrent()) return false;
	artifactContents.update((items) => {
		const current = items ?? [];
		const found = current.some(matches);
		const updated = current.map((item) => (matches(item) ? merge(item) : item));
		return !found && addIfMissing ? [...updated, merge(artifact)] : updated;
	});
	return true;
};

const openWorkspaceArtifact = async (
	artifact: WorkspaceContent,
	id: string,
	onError: () => void
) => {
	const targetChatId = get(chatId);
	const generation = ++openGeneration;
	const isCurrent = () => generation === openGeneration && get(chatId) === targetChatId;
	const unsubscribe = [chatId, artifactCode, showControls, showArtifacts, showEmbeds].map(
		(store) => {
			const initial = get<unknown>(store);
			return store.subscribe((value) => {
				if (value !== initial && generation === openGeneration) cancelPendingWorkspaceOpen();
			});
		}
	);
	try {
		if (!(await selectWorkspaceArtifact(artifact, targetChatId, true, isCurrent))) return;
		if (!isCurrent()) return;
		unsubscribe.forEach((stop) => stop());
		workspaceOpenRequestId.set(id);
		artifactCode.set(id);
		showEmbeds.set(false);
		showArtifacts.set(true);
		showControls.set(true);
	} catch {
		if (isCurrent()) onError();
	} finally {
		unsubscribe.forEach((stop) => stop());
	}
};

export const openCanvasArtifact = (artifact: CanvasNoteArtifact, onError: () => void) =>
	openWorkspaceArtifact(
		artifact,
		artifact.canvasId || artifact.noteId || artifact.content,
		onError
	);

export const openWebPreviewArtifact = (artifact: WebPreviewArtifact, onError: () => void) =>
	openWorkspaceArtifact(artifact, artifact.previewId, onError);
