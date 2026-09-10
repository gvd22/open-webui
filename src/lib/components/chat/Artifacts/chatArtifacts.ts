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

export type WorkspaceOutputArtifact = CanvasNoteArtifact | WebPreviewArtifact;

// The output catalog includes saved objects even when their message branch is not visible.
// It does not add tabs or trigger the first-creation auto-open behavior.
export const getWorkspaceOutputArtifacts = (
	current: ChatWorkspaceArtifact[],
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
				mergePersistedCanvasArtifact(item as CanvasNoteArtifact, canvases[item.canvasId])
			);
		} else if (item.type === 'web-preview' && item.previewId) {
			items.set(
				`preview:${item.previewId}`,
				mergePersistedWebPreview(item as WebPreviewArtifact, previews[item.previewId])
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
	currentArtifacts: ChatWorkspaceArtifact[];
	persistedCanvasDocuments: Record<string, any>;
	persistedWebPreviews: Record<string, any>;
	knownWebPreviewIds: Set<string>;
	knownCanvasIds?: Set<string>;
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
