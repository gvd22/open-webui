import {
	getCanvasNoteArtifactsFromOutput,
	mergePersistedCanvasArtifact,
	type CanvasNoteArtifact,
	preserveNewerCanvas,
	preserveWorkspaceSelection
} from './canvas';
import {
	findNewToolWebPreview,
	getWebPreviewsFromOutput,
	mergePersistedWebPreview,
	preserveNewerWebPreview,
	type WebPreviewArtifact
} from './webPreview';
import type { WorkspaceContent } from './workspace';
import type { Writable } from 'svelte/store';

type WorkspaceDocuments = {
	_canvas_documents: Record<string, Record<string, unknown>>;
	_web_preview_documents: Record<string, Record<string, unknown>>;
};

export const createWorkspaceReferenceHydrator = ({
	contents,
	getChatId,
	loadChat,
	onLoaded,
	onError
}: {
	contents: Writable<WorkspaceContent[] | null>;
	getChatId: () => string;
	loadChat: (id: string) => Promise<{ chat?: Partial<WorkspaceDocuments> } | null>;
	onLoaded: (documents: WorkspaceDocuments) => void;
	onError: (error: unknown) => void;
}) => {
	let key = '';
	let generation = 0;
	let warningShown = false;
	return {
		reset() {
			key = '';
			generation++;
			warningShown = false;
		},
		async hydrate(items: WorkspaceContent[]) {
			const chatId = getChatId();
			if (!chatId) return;
			const references = items.flatMap((item) => {
				if (
					item.type === 'canvas-note' &&
					item.source === 'tool' &&
					item.hasContentPayload === false
				)
					return [['canvas', item.canvasId, item.updatedAt ?? 0]];
				if (item.type === 'web-preview' && item.source === 'tool' && !item.hasFilePayload)
					return [['preview', item.previewId, item.updatedAt ?? 0]];
				return [];
			});
			if (!references.length) return;
			const nextKey = JSON.stringify([chatId, references]);
			if (key === nextKey) return;
			key = nextKey;
			const requestGeneration = ++generation;
			const isCurrent = () =>
				getChatId() === chatId && key === nextKey && generation === requestGeneration;
			try {
				const loaded = await loadChat(chatId);
				if (!isCurrent()) return;
				if (!loaded?.chat) throw new Error('Workspace chat could not be loaded');
				const documents: WorkspaceDocuments = {
					_canvas_documents: loaded.chat._canvas_documents ?? {},
					_web_preview_documents: loaded.chat._web_preview_documents ?? {}
				};
				onLoaded(documents);
				contents.update((current) =>
					(current ?? []).map((item) => {
						if (item.type === 'canvas-note')
							return mergePersistedCanvasArtifact(item, documents._canvas_documents[item.canvasId]);
						if (item.type === 'web-preview')
							return mergePersistedWebPreview(
								item,
								documents._web_preview_documents[item.previewId]
							);
						return item;
					})
				);
				warningShown = false;
			} catch (error) {
				if (!isCurrent()) return;
				key = '';
				if (!warningShown) {
					warningShown = true;
					onError(error);
				}
			}
		}
	};
};

export type ChatWorkspaceArtifact = CanvasNoteArtifact | WebPreviewArtifact;

export type WorkspaceOutputArtifact = CanvasNoteArtifact | WebPreviewArtifact;

// The output catalog includes saved objects even when their message branch is not visible.
// It does not add tabs or trigger the first-creation auto-open behavior.
export const getWorkspaceOutputArtifacts = (
	current: WorkspaceContent[],
	canvases: Record<string, any> = {},
	previews: Record<string, any> = {}
): WorkspaceOutputArtifact[] => {
	const items = new Map<string, WorkspaceOutputArtifact>();
	for (const [canvasId, saved] of Object.entries(canvases)) {
		if (!saved || typeof saved !== 'object') continue;
		items.set(
			`canvas:${canvasId}`,
			mergePersistedCanvasArtifact(
				{ type: 'canvas-note', canvasId, title: '', content: '', source: 'tool' },
				saved
			)
		);
	}
	for (const [previewId, saved] of Object.entries(previews)) {
		if (!saved || typeof saved !== 'object') continue;
		items.set(
			`preview:${previewId}`,
			mergePersistedWebPreview(
				{
					type: 'web-preview',
					previewId,
					title: '',
					content: '',
					source: 'tool',
					entrypoint: 'index.html',
					files: {}
				},
				saved
			)
		);
	}
	for (const item of current) {
		if (item.type === 'canvas-note' && item.canvasId) {
			items.set(
				`canvas:${item.canvasId}`,
				mergePersistedCanvasArtifact(item, canvases[item.canvasId])
			);
		} else if (item.type === 'web-preview' && item.previewId) {
			items.set(
				`preview:${item.previewId}`,
				mergePersistedWebPreview(item, previews[item.previewId])
			);
		}
	}
	return [...items.values()];
};

export const buildChatWorkspaceArtifacts = ({
	messages,
	currentArtifacts,
	persistedCanvasDocuments,
	persistedWebPreviews,
	knownWebPreviewIds,
	knownCanvasIds = new Set<string>(),
	selectedArtifactId
}: {
	messages: any[];
	currentArtifacts: WorkspaceContent[];
	persistedCanvasDocuments: Record<string, any>;
	persistedWebPreviews: Record<string, any>;
	knownWebPreviewIds: Set<string>;
	knownCanvasIds?: Set<string>;
	selectedArtifactId: string | null;
}) => {
	let contents: ChatWorkspaceArtifact[] = [];
	const previousCanvases = currentArtifacts.filter((item) => item?.type === 'canvas-note');
	const previousPreviews = currentArtifacts.filter((item) => item?.type === 'web-preview');

	const mergePreviews = (previews: WebPreviewArtifact[]) => {
		for (const preview of previews) {
			const index = contents.findIndex(
				(item) => item.type === 'web-preview' && item.previewId === preview.previewId
			);
			const candidate =
				(index >= 0 ? contents[index] : undefined) ??
				previousPreviews.find((item) => item.previewId === preview.previewId);
			const previous = candidate?.type === 'web-preview' ? candidate : undefined;
			const files = preview.hasFilePayload ? preview.files : (previous?.files ?? {});
			const merged = preserveNewerWebPreview(
				{
					...previous,
					...preview,
					files,
					content: files[preview.entrypoint]?.content ?? previous?.content ?? ''
				},
				previous
			);
			if (index >= 0) contents[index] = merged;
			else contents.push(merged);
		}
	};

	const mergeCanvases = (artifacts: CanvasNoteArtifact[]) => {
		for (const artifact of artifacts) {
			const key = artifact.canvasId || artifact.noteId;
			const index = key
				? contents.findIndex(
						(item) => item.type === 'canvas-note' && (item.canvasId === key || item.noteId === key)
					)
				: -1;
			const candidate =
				index >= 0
					? contents[index]
					: previousCanvases.find(
							(item) =>
								item.canvasId === artifact.canvasId ||
								(artifact.noteId && item.noteId === artifact.noteId)
						);
			const previous = candidate?.type === 'canvas-note' ? candidate : undefined;
			const merged = preserveNewerCanvas(
				{
					...artifact,
					noteId: artifact.noteId ?? previous?.noteId,
					title: previous?.titleEdited ? (previous.title ?? artifact.title) : artifact.title,
					titleEdited: previous?.titleEdited ?? false,
					updatedAt: artifact.updatedAt ?? previous?.updatedAt ?? 0
				},
				previous
			);
			if (index >= 0) contents[index] = merged;
			else contents.push(merged);
		}
	};

	for (const message of messages) {
		if (message?.role === 'user') continue;
		mergeCanvases(getCanvasNoteArtifactsFromOutput(message?.output ?? []));
		mergePreviews(getWebPreviewsFromOutput(message?.output ?? []));
	}

	contents = contents.map((item) => {
		if (item.type === 'web-preview' && item.previewId) {
			return mergePersistedWebPreview(item, persistedWebPreviews[item.previewId]);
		}
		if (item.type !== 'canvas-note' || !item.canvasId) return item;
		const persisted = persistedCanvasDocuments[item.canvasId];
		return persisted ? mergePersistedCanvasArtifact(item, persisted) : item;
	});

	const canvases = contents.filter((item) => item.type === 'canvas-note');
	const previews = contents.filter((item) => item.type === 'web-preview');
	const latestCanvas = [...canvases]
		.reverse()
		.find(
			(item) => item.source === 'tool' && !knownCanvasIds.has(item.canvasId ?? item.noteId ?? '')
		);
	const canvasAutoOpenId = latestCanvas
		? preserveWorkspaceSelection(selectedArtifactId, latestCanvas?.canvasId ?? latestCanvas?.noteId)
		: null;
	const newToolPreview = findNewToolWebPreview(previews, knownWebPreviewIds);

	return {
		contents,
		canvasAutoOpenId,
		newToolPreviewId: newToolPreview?.previewId ?? null,
		knownWebPreviewIds: new Set([
			...knownWebPreviewIds,
			...previews.map((preview) => preview.previewId)
		]),
		knownCanvasIds: new Set([
			...knownCanvasIds,
			...canvases.map((item) => item.canvasId ?? item.noteId ?? '')
		])
	};
};
