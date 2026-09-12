import { WEBUI_API_BASE_URL } from '$lib/constants';

const artifactRequest = async (
	path: string,
	token: string,
	options: { body?: unknown } = {}
): Promise<any> => {
	const response = await fetch(`${WEBUI_API_BASE_URL}/chats/${path}`, {
		method: 'POST',
		headers: {
			Accept: 'application/json',
			...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
			...(token && { authorization: `Bearer ${token}` })
		},
		...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {})
	});

	if (!response.ok) {
		const body = await response.json().catch(() => ({}));
		throw Object.assign(body, { status: response.status });
	}

	return response.json();
};

const artifactPath = (chatId: string, kind: 'canvas' | 'web-preview', artifactId: string) =>
	`${encodeURIComponent(chatId)}/${kind}/${encodeURIComponent(artifactId)}`;

export const updateTransientCanvasDocument = async (
	token: string,
	chatId: string,
	canvasId: string,
	document: {
		title: string;
		content: string;
		title_edited: boolean;
		expected_updated_at?: number | null;
		expected_content_hash?: string | null;
	}
) => artifactRequest(artifactPath(chatId, 'canvas', canvasId), token, { body: document });

export const undoLastTransientCanvasAiUpdate = async (
	token: string,
	chatId: string,
	canvasId: string,
	version: { expected_updated_at: number; expected_content_hash: string }
) =>
	artifactRequest(`${artifactPath(chatId, 'canvas', canvasId)}/undo-ai`, token, { body: version });

export const undoLastWebPreviewAiUpdate = async (
	token: string,
	chatId: string,
	previewId: string,
	version: { expected_updated_at: number; expected_content_hash: string }
) =>
	artifactRequest(`${artifactPath(chatId, 'web-preview', previewId)}/undo-ai`, token, {
		body: version
	});

export const selectTransientCanvasDocument = async (
	token: string,
	chatId: string,
	canvasId: string
) => artifactRequest(`${artifactPath(chatId, 'canvas', canvasId)}/select`, token);

export const promoteTransientCanvasDocument = async (
	token: string,
	chatId: string,
	canvasId: string,
	document: {
		title: string;
		content: string;
		html?: string;
		json?: object | null;
		expected_updated_at: number | null;
		expected_content_hash: string | null;
	}
) =>
	artifactRequest(`${artifactPath(chatId, 'canvas', canvasId)}/promote`, token, { body: document });

export const updateTransientWebPreview = async (
	token: string,
	chatId: string,
	previewId: string,
	document: {
		title: string;
		entrypoint: string;
		files: Record<string, unknown>;
		exported_path?: string | null;
		exported_runtime?: string | null;
		expected_updated_at?: number | null;
		expected_content_hash?: string | null;
	}
) => artifactRequest(artifactPath(chatId, 'web-preview', previewId), token, { body: document });

export const selectTransientWebPreview = async (token: string, chatId: string, previewId: string) =>
	artifactRequest(`${artifactPath(chatId, 'web-preview', previewId)}/select`, token);

export const updateWorkspaceOutputs = async (
	token: string,
	chatId: string,
	mutation: { upsert?: Record<string, unknown>[]; remove?: string[] }
) =>
	artifactRequest(`${encodeURIComponent(chatId)}/workspace-outputs`, token, {
		body: { upsert: mutation.upsert ?? [], remove: mutation.remove ?? [] }
	});
