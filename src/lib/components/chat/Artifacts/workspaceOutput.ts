import {
	getCanvasNoteArtifactsFromOutput,
	getCanvasToolErrorFromOutput,
	getCanvasToolWarningFromOutput,
	type CanvasNoteArtifact
} from './canvas';
import {
	getWebPreviewErrorFromOutput,
	getWebPreviewWarningFromOutput,
	getWebPreviewsFromOutput,
	type WebPreviewArtifact
} from './webPreview';

import type { OutputDisplayItem, OutputItem } from '../Messages/structuredOutput';

export type WorkspaceDisplayItem =
	| {
			type: 'canvas';
			id: string;
			artifact: CanvasNoteArtifact;
	  }
	| {
			type: 'canvas_activity';
			id: string;
			name: string;
			done: boolean;
			artifact?: CanvasNoteArtifact;
			error?: string;
	  }
	| {
			type: 'web_preview';
			id: string;
			artifact: WebPreviewArtifact;
	  }
	| {
			type: 'web_preview_activity';
			id: string;
			name: string;
			done: boolean;
			artifact?: WebPreviewArtifact;
			error?: string;
	  };

export function dedupeCanvasDisplayItems(
	items: OutputDisplayItem[],
	previousCanvasIds: string[] = []
): OutputDisplayItem[] {
	const seenCanvasIds = new Set(previousCanvasIds);

	return items.filter((item) => {
		if (item.type !== 'canvas') {
			return true;
		}

		if (seenCanvasIds.has(item.artifact.canvasId)) {
			return false;
		}

		seenCanvasIds.add(item.artifact.canvasId);
		return true;
	});
}

export function dedupeWebPreviewDisplayItems(
	items: OutputDisplayItem[],
	previousPreviewIds: string[] = []
): OutputDisplayItem[] {
	const seen = new Set(previousPreviewIds);
	return items.filter((item) => {
		if (item.type !== 'web_preview') return true;
		if (seen.has(item.artifact.previewId)) return false;
		seen.add(item.artifact.previewId);
		return true;
	});
}

const CANVAS_TOOL_NAMES = new Set([
	'canvas_create_document',
	'canvas_update_document',
	'canvas_select_document',
	'canvas_list_documents',
	'canvas_read_document',
	'canvas_replace_text'
]);
const WEB_PREVIEW_TOOL_NAMES = new Set([
	'web_preview_create',
	'web_preview_update',
	'web_preview_select',
	'web_preview_list',
	'web_preview_read_file',
	'web_preview_replace_text',
	'web_preview_import_runtime_file'
]);

export function getWorkspaceResultItems(item: OutputItem, index: number): OutputDisplayItem[] {
	const displayItems: OutputDisplayItem[] = [];
	const webPreviews = getWebPreviewsFromOutput([item]);
	if (webPreviews.length > 0) {
		for (const artifact of webPreviews) {
			displayItems.push({ type: 'web_preview', id: artifact.previewId, artifact });
		}
	}
	const webPreviewError = getWebPreviewErrorFromOutput([item]);
	if (webPreviewError) {
		displayItems.push({
			type: 'message',
			id: item.id ?? `web-preview-error-${index}`,
			text: webPreviewError
		});
	}
	const webPreviewWarning = getWebPreviewWarningFromOutput([item]);
	if (webPreviewWarning) {
		displayItems.push({
			type: 'message',
			id: `${item.id ?? `web-preview-${index}`}-warning`,
			text: webPreviewWarning
		});
	}
	const canvasArtifacts = getCanvasNoteArtifactsFromOutput([item]);
	if (canvasArtifacts.length > 0) {
		for (const artifact of canvasArtifacts) {
			displayItems.push({
				type: 'canvas',
				id: artifact.canvasId,
				artifact
			});
		}
	}

	const canvasError = getCanvasToolErrorFromOutput([item]);
	if (canvasError) {
		displayItems.push({
			type: 'message',
			id: item.id ?? `canvas-error-${index}`,
			text: canvasError
		});
	}

	const canvasWarning = getCanvasToolWarningFromOutput([item]);
	if (canvasWarning) {
		displayItems.push({
			type: 'message',
			id: `${item.id ?? `canvas-${index}`}-warning`,
			text: canvasWarning
		});
	}
	return displayItems;
}

export function getWorkspaceActivity(
	item: OutputItem,
	index: number,
	result: OutputItem | undefined,
	isDone: () => boolean
): WorkspaceDisplayItem | null {
	if (['pending', 'requires_approval', 'queued', 'rejected'].includes(item.status ?? ''))
		return null;
	const webPreview = result ? getWebPreviewsFromOutput([result])[0] : undefined;
	if (WEB_PREVIEW_TOOL_NAMES.has(item.name ?? '') || webPreview) {
		return {
			type: 'web_preview_activity',
			id: `web-preview-activity-${item.call_id ?? item.id ?? index}`,
			name: item.name ?? 'web_preview_update',
			done: isDone(),
			artifact: webPreview,
			error: result ? getWebPreviewErrorFromOutput([result]) : undefined
		};
	}
	const canvas = result ? getCanvasNoteArtifactsFromOutput([result])[0] : undefined;
	if (CANVAS_TOOL_NAMES.has(item.name ?? '') || canvas) {
		return {
			type: 'canvas_activity',
			id: `canvas-activity-${item.call_id ?? item.id ?? index}`,
			name: item.name ?? 'canvas_update_document',
			done: isDone(),
			artifact: canvas,
			error: result ? getCanvasToolErrorFromOutput([result]) : undefined
		};
	}
	return null;
}
