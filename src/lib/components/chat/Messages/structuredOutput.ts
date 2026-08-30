import {
	getCanvasNoteArtifactsFromOutput,
	getCanvasToolErrorFromOutput,
	getCanvasToolWarningFromOutput,
	type CanvasNoteArtifact
} from '../Artifacts/canvas';
import {
	getWebPreviewErrorFromOutput,
	getWebPreviewsFromOutput,
	type WebPreviewArtifact
} from '../Artifacts/webPreview';

export type OutputContentPart = {
	type?: string;
	text?: unknown;
	[key: string]: unknown;
};

export type OutputItem = {
	type?: string;
	id?: string;
	call_id?: string;
	name?: string;
	status?: string;
	arguments?: unknown;
	content?: OutputContentPart[];
	summary?: OutputContentPart[];
	output?: OutputContentPart[] | string;
	files?: unknown;
	embeds?: unknown;
	code?: string;
	lang?: string;
	duration?: number | string | null;
	action?: Record<string, unknown>;
	actions?: Array<Record<string, unknown>>;
	queries?: unknown[];
	[key: string]: unknown;
};

export type OutputDetailToken = {
	summary: string;
	text: string;
	attributes: {
		type: string;
		id?: string;
		name?: string;
		done?: string;
		duration?: string;
		arguments?: string;
		files?: string;
		embeds?: string;
		output?: string;
	};
};

export type OutputDisplayItem =
	| {
			type: 'message';
			id: string;
			text: string;
	  }
	| {
			type: 'detail_single';
			id: string;
			token: OutputDetailToken;
	  }
	| {
			type: 'detail_group';
			id: string;
			tokens: OutputDetailToken[];
	  }
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

const GROUPABLE_OUTPUT_TYPES = new Set([
	'reasoning',
	'function_call',
	'open_webui:code_interpreter',
	'web_search_call',
	'file_search_call',
	'computer_call'
]);

const OPENAI_TOOL_NAMES: Record<string, string> = {
	web_search_call: 'Web Search',
	file_search_call: 'File Search',
	computer_call: 'Computer Use'
};

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

function getTextFromParts(parts: OutputContentPart[] = []): string {
	return parts
		.map((part) => {
			if (part?.text === undefined || part?.text === null) {
				return '';
			}
			return typeof part.text === 'string' ? part.text : String(part.text);
		})
		.join('');
}

function stringifyAttribute(value: unknown): string {
	if (value === undefined || value === null) {
		return '';
	}
	if (typeof value === 'string') {
		return value;
	}
	try {
		return JSON.stringify(value);
	} catch {
		return String(value);
	}
}

function isDoneStatus(status?: string): boolean {
	return status === 'completed' || status === 'failed' || status === 'incomplete';
}

function getMessageText(item: OutputItem): string {
	return getTextFromParts(item.content ?? []);
}

function getReasoningText(item: OutputItem): string {
	const summary = Array.isArray(item.summary) && item.summary.length ? item.summary : null;
	return getTextFromParts(summary ?? item.content ?? []);
}

function getToolResultText(item?: OutputItem): string {
	const output =
		typeof item?.output === 'string'
			? [{ type: 'output_text', text: item.output }]
			: (item?.output ?? []);

	return output
		.filter((part) => part?.type !== 'input_image')
		.map((part) => {
			if (part?.text === undefined || part?.text === null) {
				return '';
			}
			return typeof part.text === 'string' ? part.text : String(part.text);
		})
		.join('');
}

function buildToolCallToken(item: OutputItem, toolOutputByCallId: Record<string, OutputItem>) {
	const callId = item.call_id ?? '';
	const resultItem = toolOutputByCallId[callId];
	const isDone = isDoneStatus(item.status) || !!resultItem;
	let name = item.name ?? '';
	if (name === 'delegate_task') {
		try {
			const args =
				typeof item.arguments === 'string'
					? JSON.parse(item.arguments || '{}')
					: (item.arguments ?? {});
			const task = typeof args.task === 'string' && args.task ? args.task : '?';
			const label = args.background ? 'Background sub-agent' : 'Sub-agent';
			name = `${label}: "${task.length > 60 ? `${task.slice(0, 60)}...` : task}"`;
		} catch {
			name = 'Sub-agent';
		}
	}

	return {
		summary: isDone ? 'Tool Executed' : 'Executing...',
		text: getToolResultText(resultItem),
		attributes: {
			type: 'tool_calls',
			id: callId,
			name,
			done: isDone ? 'true' : 'false',
			arguments: stringifyAttribute(item.arguments ?? ''),
			files: stringifyAttribute(resultItem?.files),
			embeds: stringifyAttribute(resultItem?.embeds)
		}
	};
}

function buildReasoningToken(item: OutputItem, isLastItem: boolean) {
	const duration = item.duration ?? '';
	const isDone = isDoneStatus(item.status) || item.duration !== undefined || !isLastItem;
	const text = getReasoningText(item)
		.split('\n')
		.map((line) => (line.startsWith('>') ? line : `> ${line}`))
		.join('\n');

	return {
		summary: isDone ? `Thought for ${duration || 0} seconds` : 'Thinking...',
		text,
		attributes: {
			type: 'reasoning',
			done: isDone ? 'true' : 'false',
			duration: String(duration)
		}
	};
}

function buildCodeInterpreterToken(item: OutputItem, isLastItem: boolean) {
	const duration = item.duration ?? '';
	const isDone = isDoneStatus(item.status) || item.duration !== undefined || !isLastItem;
	const code = item.code ?? '';
	const lang = item.lang ?? 'python';

	return {
		summary: isDone ? 'Analyzed' : 'Analyzing...',
		text: code ? `\`\`\`${lang}\n${code}\n\`\`\`` : '',
		attributes: {
			type: 'code_interpreter',
			done: isDone ? 'true' : 'false',
			duration: String(duration),
			output: stringifyAttribute(item.output)
		}
	};
}

function getOpenAIToolSummary(item: OutputItem): string {
	if (item.type === 'web_search_call') {
		const action = item.action ?? {};
		const actionType = action.type;
		if (actionType === 'search') {
			const queries = Array.isArray(action.queries) ? action.queries : [];
			const query = typeof action.query === 'string' ? action.query : '';
			return queries.length ? `Search: ${queries.join(', ')}` : query ? `Search: ${query}` : '';
		}
		if (actionType === 'open_page' && typeof action.url === 'string') {
			return `Open page: ${action.url}`;
		}
		if (actionType === 'find_in_page' && typeof action.pattern === 'string') {
			return `Find in page: ${action.pattern}`;
		}
	}

	if (item.type === 'file_search_call') {
		const queries = item.queries ?? [];
		return queries.length ? `Queries: ${queries.join(', ')}` : '';
	}

	if (item.type === 'computer_call') {
		if (item.action?.type) {
			return `Action: ${item.action.type}`;
		}
		if (Array.isArray(item.actions) && item.actions.length) {
			return `Actions: ${item.actions.map((action) => action.type ?? '?').join(', ')}`;
		}
	}

	return '';
}

function buildOpenAIToolToken(item: OutputItem, isLastItem: boolean) {
	const isDone = isDoneStatus(item.status) || !isLastItem;
	return {
		summary: isDone ? 'Tool Executed' : 'Executing...',
		text: getOpenAIToolSummary(item),
		attributes: {
			type: 'tool_calls',
			id: item.id ?? '',
			name: OPENAI_TOOL_NAMES[item.type ?? ''] ?? item.type ?? '',
			done: isDone ? 'true' : 'false',
			arguments: ''
		}
	};
}

function buildDetailToken(
	item: OutputItem,
	isLastItem: boolean,
	toolOutputByCallId: Record<string, OutputItem>
): OutputDetailToken | null {
	if (item.type === 'function_call') {
		return buildToolCallToken(item, toolOutputByCallId);
	}
	if (item.type === 'reasoning') {
		return buildReasoningToken(item, isLastItem);
	}
	if (item.type === 'open_webui:code_interpreter') {
		return buildCodeInterpreterToken(item, isLastItem);
	}
	if (item.type && OPENAI_TOOL_NAMES[item.type]) {
		return buildOpenAIToolToken(item, isLastItem);
	}
	return null;
}

export function buildOutputDisplayItems(output: OutputItem[] = []): OutputDisplayItem[] {
	const displayItems: OutputDisplayItem[] = [];
	const currentDetailTokens: OutputDetailToken[] = [];
	const toolOutputByCallId: Record<string, OutputItem> = {};
	const canvasToolCallIds = new Set<string>();
	const canvasArtifactByCallId: Record<string, CanvasNoteArtifact> = {};
	const canvasErrorByCallId: Record<string, string> = {};
	const webPreviewToolCallIds = new Set<string>();
	const webPreviewByCallId: Record<string, WebPreviewArtifact> = {};
	const webPreviewErrorByCallId: Record<string, string> = {};

	for (const item of output) {
		if (item?.type === 'function_call_output' && item.call_id) {
			toolOutputByCallId[item.call_id] = item;
			const canvasArtifact = getCanvasNoteArtifactsFromOutput([item])[0];
			if (canvasArtifact) {
				canvasToolCallIds.add(item.call_id);
				if (canvasArtifact) {
					canvasArtifactByCallId[item.call_id] = canvasArtifact;
				}
			}
			const canvasError = getCanvasToolErrorFromOutput([item]);
			if (canvasError) {
				canvasErrorByCallId[item.call_id] = canvasError;
			}
			const webPreview = getWebPreviewsFromOutput([item])[0];
			if (webPreview) {
				webPreviewToolCallIds.add(item.call_id);
				webPreviewByCallId[item.call_id] = webPreview;
			}
			const webPreviewError = getWebPreviewErrorFromOutput([item]);
			if (webPreviewError) webPreviewErrorByCallId[item.call_id] = webPreviewError;
		}
	}

	const flushDetails = () => {
		if (currentDetailTokens.length > 1) {
			displayItems.push({
				type: 'detail_group',
				id: `detail-group-${displayItems.length}`,
				tokens: [...currentDetailTokens]
			});
		} else if (currentDetailTokens.length === 1) {
			displayItems.push({
				type: 'detail_single',
				id: `detail-${displayItems.length}`,
				token: currentDetailTokens[0]
			});
		}
		currentDetailTokens.length = 0;
	};

	output.forEach((item, index) => {
		if (item?.type === 'function_call_output') {
			const webPreviews = getWebPreviewsFromOutput([item]);
			if (webPreviews.length > 0) {
				flushDetails();
				for (const artifact of webPreviews) {
					displayItems.push({ type: 'web_preview', id: artifact.previewId, artifact });
				}
			}
			const webPreviewError = getWebPreviewErrorFromOutput([item]);
			if (webPreviewError) {
				flushDetails();
				displayItems.push({
					type: 'message',
					id: item.id ?? `web-preview-error-${index}`,
					text: webPreviewError
				});
			}
			const canvasArtifacts = getCanvasNoteArtifactsFromOutput([item]);
			if (canvasArtifacts.length > 0) {
				flushDetails();
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
				flushDetails();
				displayItems.push({
					type: 'message',
					id: item.id ?? `canvas-error-${index}`,
					text: canvasError
				});
			}

			const canvasWarning = getCanvasToolWarningFromOutput([item]);
			if (canvasWarning) {
				flushDetails();
				displayItems.push({
					type: 'message',
					id: `${item.id ?? `canvas-${index}`}-warning`,
					text: canvasWarning
				});
			}
			return;
		}

		if (
			item?.type === 'function_call' &&
			(WEB_PREVIEW_TOOL_NAMES.has(item.name ?? '') ||
				(item.call_id ? webPreviewToolCallIds.has(item.call_id) : false))
		) {
			flushDetails();
			const token = buildToolCallToken(item, toolOutputByCallId);
			displayItems.push({
				type: 'web_preview_activity',
				id: `web-preview-activity-${item.call_id ?? item.id ?? index}`,
				name: item.name ?? 'web_preview_update',
				done: token.attributes.done === 'true',
				artifact: item.call_id ? webPreviewByCallId[item.call_id] : undefined,
				error: item.call_id ? webPreviewErrorByCallId[item.call_id] : undefined
			});
			return;
		}

		if (
			item?.type === 'function_call' &&
			(CANVAS_TOOL_NAMES.has(item.name ?? '') ||
				(item.call_id ? canvasToolCallIds.has(item.call_id) : false))
		) {
			flushDetails();
			const token = buildToolCallToken(item, toolOutputByCallId);
			displayItems.push({
				type: 'canvas_activity',
				id: `canvas-activity-${item.call_id ?? item.id ?? index}`,
				name: item.name ?? 'canvas_update_document',
				done: token.attributes.done === 'true',
				artifact: item.call_id ? canvasArtifactByCallId[item.call_id] : undefined,
				error: item.call_id ? canvasErrorByCallId[item.call_id] : undefined
			});
			return;
		}

		if (item?.type && GROUPABLE_OUTPUT_TYPES.has(item.type)) {
			const token = buildDetailToken(item, index === output.length - 1, toolOutputByCallId);
			if (token) {
				currentDetailTokens.push(token);
			}
			return;
		}

		if (item?.type === 'message') {
			const text = getMessageText(item);
			if (text.trim()) {
				flushDetails();
				displayItems.push({
					type: 'message',
					id: item.id ?? `message-${index}`,
					text
				});
			}
			return;
		}

		const fallbackText = getMessageText(item);
		if (fallbackText.trim()) {
			flushDetails();
			displayItems.push({
				type: 'message',
				id: item.id ?? `output-${index}`,
				text: fallbackText
			});
		}
	});

	flushDetails();
	return displayItems;
}

export function getOutputText(output?: OutputItem[] | null): string {
	return (output ?? [])
		.filter((item) => item?.type === 'message')
		.map(getMessageText)
		.filter((text) => text.trim())
		.join('\n');
}

export function replaceOutputMessageText(
	output: OutputItem[] = [],
	oldContent: string,
	newContent: string
): OutputItem[] {
	if (!oldContent) {
		return output;
	}

	let replaced = false;
	const nextOutput = output.map((item) => {
		if (replaced || item?.type !== 'message' || !Array.isArray(item.content)) {
			return item;
		}

		const partIndex = item.content.findIndex(
			(part) => typeof part.text === 'string' && part.text.includes(oldContent)
		);
		if (partIndex === -1) {
			return item;
		}

		replaced = true;
		const nextContent = [...item.content];
		const part = nextContent[partIndex];
		nextContent[partIndex] = {
			...part,
			text: (part.text as string).replace(oldContent, newContent)
		};

		return {
			...item,
			content: nextContent
		};
	});

	return replaced ? nextOutput : output;
}
