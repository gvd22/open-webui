import { get, type Writable } from 'svelte/store';
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

const workspaceArtifacts = artifactContents as unknown as Writable<WorkspaceContent[] | null>;

// Selecting a tab hydrates existing content; only an explicit card open may add it.
export const selectWorkspaceArtifact = async (
	artifact: WorkspaceContent,
	targetChatId: string,
	addIfMissing = false
): Promise<boolean> => {
	if (get(chatId) !== targetChatId) return false;
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
			mergePersistedCanvasArtifact(item as CanvasNoteArtifact, {
				...document,
				content_hash: document.contentHash
			});
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
		merge = (item) => mergePersistedWebPreview(item as WebPreviewArtifact, document);
	} else {
		return true;
	}
	if (get(chatId) !== targetChatId) return false;
	workspaceArtifacts.update((items) => {
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
	try {
		if (!(await selectWorkspaceArtifact(artifact, targetChatId, true))) return;
		if (get(chatId) !== targetChatId) return;
		workspaceOpenRequestId.set(id);
		artifactCode.set(id);
		showEmbeds.set(false);
		showArtifacts.set(true);
		showControls.set(true);
	} catch {
		if (get(chatId) === targetChatId) onError();
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
