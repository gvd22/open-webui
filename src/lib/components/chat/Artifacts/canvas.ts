import { createMessagesList } from '$lib/utils';

export type CanvasNoteArtifact = {
	type: 'canvas-note';
	title: string;
	content: string;
	canvasId: string;
	noteId?: string;
	titleEdited?: boolean;
	canUndoAiUpdate?: boolean;
	updatedAt?: number;
	contentHash?: string;
	hasContentPayload?: boolean;
	source: 'tool';
};

const cleanTitleCandidate = (value: string) =>
	value
		.replace(/[`*_#>\[\]]/g, '')
		.replace(/^[-+]\s+/, '')
		.replace(/\s+/g, ' ')
		.trim();

const GENERIC_CANVAS_TITLES = new Set([
	'canvas',
	'dokument',
	'draft',
	'entwurf',
	'neuer entwurf',
	'notiz',
	'projekt-notiz',
	'projekt notiz',
	'project note',
	'untitled'
]);

const truncateCanvasTitle = (title: string) =>
	title.length > 48 ? `${title.slice(0, 45).trim()}...` : title;

export const generateCanvasTitle = (content = '', fallback = '') => {
	const fallbackTitle = cleanTitleCandidate(fallback);
	if (fallbackTitle && !GENERIC_CANVAS_TITLES.has(fallbackTitle.toLocaleLowerCase())) {
		return truncateCanvasTitle(fallbackTitle);
	}

	const heading = content
		.split('\n')
		.map((line) => line.match(/^\s*#{1,6}\s+(.+)$/)?.[1] ?? '')
		.map(cleanTitleCandidate)
		.find((line) => line.length > 0);
	const lines = content
		.split('\n')
		.map(cleanTitleCandidate)
		.filter((line) => line.length > 0);

	const sentence =
		heading ??
		lines.find((line) => line.length >= 18 && !['Projekt', 'Status', 'Notiz'].includes(line)) ??
		lines.find((line) => line.length >= 8) ??
		lines[0] ??
		fallbackTitle;
	const title = cleanTitleCandidate(sentence || fallbackTitle || 'Neuer Entwurf');

	return truncateCanvasTitle(title);
};

export const canSynchronizeCanvasDocumentChange = (
	isApplyingExternalContent: boolean,
	suppressedUntil: number,
	now = Date.now()
) => !isApplyingExternalContent && now >= suppressedUntil;

export const canUseNotes = (
	enabled: boolean,
	role: string | undefined,
	permission: boolean | undefined
) => enabled && (role === 'admin' || permission === true);

export const preserveWorkspaceSelection = (
	selectedId: string | null | undefined,
	newObjectId: string | null | undefined
) => selectedId || newObjectId || null;

const getToolOutputParts = (item: any) => {
	const output = item?.output ?? item?.content ?? [];
	if (typeof output === 'string') {
		return [{ text: output }];
	}
	return Array.isArray(output) ? output : [output];
};

const getToolOutputText = (item: any) =>
	getToolOutputParts(item)
		.map((part: any) => {
			const text = part?.text ?? part?.content;
			if (text === undefined || text === null) {
				return '';
			}
			return typeof text === 'string' ? text : String(text);
		})
		.join('')
		.trim();

const normalizeToolCanvasDocument = (value: any): CanvasNoteArtifact | null => {
	if (value?.type !== 'canvas.document' || !value?.canvasId) {
		return null;
	}

	const hasContentPayload = typeof value.content?.md === 'string';
	const md = hasContentPayload ? value.content.md : '';
	const generatedTitle = generateCanvasTitle(md, value.title ?? '');

	return {
		type: 'canvas-note',
		title: generatedTitle,
		content: typeof md === 'string' ? md : '',
		canvasId: value.canvasId,
		noteId: value.noteId,
		titleEdited: Boolean(value.titleEdited),
		canUndoAiUpdate: Boolean(value.canUndoAiUpdate),
		updatedAt: Number(value.updatedAt ?? 0),
		contentHash: value.contentHash ?? undefined,
		source: 'tool',
		...(hasContentPayload ? {} : { hasContentPayload: false })
	};
};

export const getCanvasNoteArtifactsFromOutput = (output: any[] = []): CanvasNoteArtifact[] =>
	output
		.filter((item) => item?.type === 'function_call_output')
		.flatMap((item) => {
			const text = getToolOutputText(item);
			if (!text) {
				return [];
			}

			try {
				const parsed = JSON.parse(text);
				const values = Array.isArray(parsed) ? parsed : [parsed];
				return values
					.map(normalizeToolCanvasDocument)
					.filter((artifact): artifact is CanvasNoteArtifact => artifact !== null);
			} catch {
				return [];
			}
		});

// Chat output stores compact Canvas references. Canonical content is hydrated
// from the chat-scoped document store when the Workspace opens.
export const getCanvasNoteArtifactsFromHistory = (history: any): CanvasNoteArtifact[] => {
	if (!history?.messages || history.currentId === undefined || history.currentId === null) {
		return [];
	}

	const documents = new Map<string, CanvasNoteArtifact>();
	for (const message of createMessagesList(history, history.currentId)) {
		if (message?.role === 'user') continue;

		for (const artifact of getCanvasNoteArtifactsFromOutput(message?.output ?? [])) {
			documents.set(artifact.canvasId || artifact.noteId || artifact.content, artifact);
		}
	}

	return Array.from(documents.values());
};

export const hasNewCanvasArtifact = (
	previous: Array<Pick<CanvasNoteArtifact, 'canvasId' | 'noteId'>>,
	current: Array<Pick<CanvasNoteArtifact, 'canvasId' | 'noteId'>>
) => {
	const previousIds = new Set(previous.map((artifact) => artifact.canvasId || artifact.noteId));
	return current.some((artifact) => !previousIds.has(artifact.canvasId || artifact.noteId));
};

const getCanvasToolStatusMessage = (output: any[], type: string, field: string): string => {
	for (const item of output) {
		if (item?.type !== 'function_call_output') continue;

		const text = getToolOutputText(item);
		if (!text) continue;

		try {
			const result = JSON.parse(text);
			if (result?.type === type && typeof result[field] === 'string') {
				return result[field];
			}
		} catch {
			// Non-Canvas tool output is handled by the normal structured renderer.
		}
	}

	return '';
};

export const getCanvasToolErrorFromOutput = (output: any[] = []): string =>
	getCanvasToolStatusMessage(output, 'canvas.error', 'message') ||
	getCanvasToolStatusMessage(output, 'canvas.conflict', 'message');

export const preserveNewerCanvas = (
	incoming: CanvasNoteArtifact,
	current?: CanvasNoteArtifact
): CanvasNoteArtifact =>
	current && current.hasContentPayload !== false && Number(current.updatedAt ?? 0) > 0 &&
	Number(current.updatedAt ?? 0) >= Number(incoming.updatedAt ?? 0)
		? { ...incoming, ...current }
		: incoming;

export const getCanvasToolWarningFromOutput = (output: any[] = []): string =>
	getCanvasToolStatusMessage(output, 'canvas.document', 'warning') ||
	getCanvasToolStatusMessage(output, 'canvas.documents', 'warning');

export const mergePersistedCanvasArtifact = (
	artifact: CanvasNoteArtifact,
	persisted: Record<string, any> | null | undefined
): CanvasNoteArtifact => {
	if (!persisted) return artifact;

	const persistedUpdatedAt = Number(persisted.updated_at ?? 0);
	const artifactUpdatedAt = Number(artifact.updatedAt ?? 0);
	const persistedCanHydrate = !artifactUpdatedAt || persistedUpdatedAt >= artifactUpdatedAt;
	const persistedIsNewer =
		persistedCanHydrate &&
		(artifact.hasContentPayload === false ||
			!artifactUpdatedAt ||
			persistedUpdatedAt > artifactUpdatedAt);

	return {
		...artifact,
		content: persistedIsNewer ? (persisted.content ?? artifact.content) : artifact.content,
		noteId: Object.prototype.hasOwnProperty.call(persisted, 'note_id')
			? (persisted.note_id ?? undefined)
			: artifact.noteId,
		title: persistedIsNewer && persisted.title ? persisted.title : artifact.title,
		titleEdited: persistedIsNewer ? Boolean(persisted.title_edited) : Boolean(artifact.titleEdited),
		canUndoAiUpdate: persistedIsNewer
			? Boolean(persisted.last_ai_update)
			: Boolean(artifact.canUndoAiUpdate),
		updatedAt: Math.max(persistedUpdatedAt, artifactUpdatedAt),
		contentHash: persisted.content_hash ?? artifact.contentHash,
		hasContentPayload: persistedCanHydrate ? true : artifact.hasContentPayload
	};
};
