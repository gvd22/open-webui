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

type WorkspaceArtifact = CanvasNoteArtifact | WebPreviewArtifact;
const workspaceArtifacts = artifactContents as unknown as Writable<WorkspaceArtifact[] | null>;

const revealWorkspaceArtifact = (id: string) => {
	workspaceOpenRequestId.set(id);
	artifactCode.set(id);
	showEmbeds.set(false);
	showArtifacts.set(true);
	showControls.set(true);
};

export const openCanvasArtifact = async (artifact: CanvasNoteArtifact, onError: () => void) => {
	const targetChatId = get(chatId);
	const canvasId = artifact.canvasId;
	const selectedId = canvasId || artifact.noteId || artifact.content;

	if (targetChatId && canvasId) {
		try {
			const document = await selectTransientCanvasDocument(
				localStorage.token,
				targetChatId,
				canvasId
			);
			if (get(chatId) !== targetChatId) return;

			workspaceArtifacts.update((items) => {
				const current = items ?? [];
				let found = false;
				const updated = current.map((item) => {
					if (item?.type !== 'canvas-note' || item.canvasId !== canvasId) return item;
					found = true;
					return mergePersistedCanvasArtifact(item, {
						...document,
						content_hash: document.contentHash
					});
				});
				return found
					? updated
					: [
							...updated,
							mergePersistedCanvasArtifact(artifact, {
								...document,
								content_hash: document.contentHash
							})
						];
			});
		} catch {
			if (get(chatId) === targetChatId) onError();
			return;
		}
	}

	if (get(chatId) === targetChatId) revealWorkspaceArtifact(selectedId);
};

export const openWebPreviewArtifact = async (artifact: WebPreviewArtifact, onError: () => void) => {
	const targetChatId = get(chatId);
	const previewId = artifact.previewId;

	if (targetChatId && artifact.source === 'tool') {
		try {
			const document = await selectTransientWebPreview(localStorage.token, targetChatId, previewId);
			if (get(chatId) !== targetChatId) return;

			workspaceArtifacts.update((items) => {
				const current = items ?? [];
				let found = false;
				const updated = current.map((item) => {
					if (item?.type !== 'web-preview' || item.previewId !== previewId) return item;
					found = true;
					return mergePersistedWebPreview(item, document);
				});
				return found ? updated : [...updated, mergePersistedWebPreview(artifact, document)];
			});
		} catch {
			if (get(chatId) === targetChatId) onError();
			return;
		}
	}

	if (get(chatId) === targetChatId) revealWorkspaceArtifact(previewId);
};
