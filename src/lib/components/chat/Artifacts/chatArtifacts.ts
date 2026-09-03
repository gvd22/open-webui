import {
	getCanvasNoteArtifactsFromOutput,
	hasNewCanvasArtifact,
	mergePersistedCanvasArtifact,
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

export type ChatWorkspaceArtifact = {
	type: string;
	content: string;
	title?: string;
	canvasId?: string;
	noteId?: string;
	previewId?: string;
	entrypoint?: string;
	files?: Record<string, any>;
	hasFilePayload?: boolean;
	contentHash?: string;
	titleEdited?: boolean;
	updatedAt?: number;
	source?: string;
};

export const buildChatWorkspaceArtifacts = ({
	messages,
	currentArtifacts,
	persistedCanvasDocuments,
	persistedWebPreviews,
	knownWebPreviewIds,
	selectedArtifactId
}: {
	messages: any[];
	currentArtifacts: ChatWorkspaceArtifact[];
	persistedCanvasDocuments: Record<string, any>;
	persistedWebPreviews: Record<string, any>;
	knownWebPreviewIds: Set<string>;
	selectedArtifactId: string | null;
}) => {
	let contents: ChatWorkspaceArtifact[] = [];
	const previousCanvases = currentArtifacts.filter((item) => item?.type === 'canvas-note');
	const previousPreviews = currentArtifacts.filter(
		(item) => item?.type === 'web-preview'
	) as WebPreviewArtifact[];

	const mergePreviews = (previews: WebPreviewArtifact[]) => {
		for (const preview of previews) {
			const index = contents.findIndex((item) => item.previewId === preview.previewId);
			const previous =
				(index >= 0 ? contents[index] : undefined) ??
				previousPreviews.find((item) => item.previewId === preview.previewId);
			const files = preview.hasFilePayload ? preview.files : (previous?.files ?? {});
			const merged = preserveNewerWebPreview(
				{
					...previous,
					...preview,
					files,
					content: files[preview.entrypoint]?.content ?? previous?.content ?? ''
				} as WebPreviewArtifact,
				previous as WebPreviewArtifact | undefined
			);
			if (index >= 0) contents[index] = merged;
			else contents.push(merged);
		}
	};

	const mergeCanvases = (artifacts: any[]) => {
		for (const artifact of artifacts) {
			const key = artifact.canvasId || artifact.noteId;
			const index = key
				? contents.findIndex(
						(item) => item.type === 'canvas-note' && (item.canvasId === key || item.noteId === key)
					)
				: -1;
			const previous =
				index >= 0
					? contents[index]
					: previousCanvases.find(
							(item) =>
								item.canvasId === artifact.canvasId ||
								(artifact.noteId && item.noteId === artifact.noteId)
						);
			const merged = preserveNewerCanvas(
				{
					...artifact,
					noteId: artifact.noteId ?? previous?.noteId,
					title: previous?.titleEdited ? (previous.title ?? artifact.title) : artifact.title,
					titleEdited: previous?.titleEdited ?? false,
					updatedAt: artifact.updatedAt ?? previous?.updatedAt ?? 0
				},
				previous as any
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
			return mergePersistedWebPreview(
				item as WebPreviewArtifact,
				persistedWebPreviews[item.previewId]
			);
		}
		if (item.type !== 'canvas-note' || !item.canvasId) return item;
		const persisted = persistedCanvasDocuments[item.canvasId];
		return persisted ? mergePersistedCanvasArtifact(item as any, persisted) : item;
	});

	const canvases = contents.filter((item) => item.type === 'canvas-note');
	const previews = contents.filter((item) => item.type === 'web-preview') as WebPreviewArtifact[];
	const latestCanvas = canvases.at(-1);
	const canvasAutoOpenId =
		hasNewCanvasArtifact(previousCanvases as any, canvases as any) &&
		contents.some((item) => item.type === 'canvas-note' && item.source === 'tool')
			? preserveWorkspaceSelection(
					selectedArtifactId,
					latestCanvas?.canvasId ?? latestCanvas?.noteId
				)
			: null;
	const newToolPreview = findNewToolWebPreview(previews, knownWebPreviewIds);

	return {
		contents,
		canvasAutoOpenId,
		newToolPreviewId: newToolPreview?.previewId ?? null,
		knownWebPreviewIds: new Set(previews.map((preview) => preview.previewId))
	};
};
