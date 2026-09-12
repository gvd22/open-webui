import { get } from 'svelte/store';
import { chatId as activeChatId } from '$lib/stores';
import { selectTransientCanvasDocument } from '$lib/apis/chats';
import { WORKSPACE_ASK_AI_EVENT } from './artifactEditing';
import { canvasSelectionSource } from './canvasSelectionSource';

export async function addCanvasSelectionToChat({
	chatId,
	canvasId,
	content,
	selection,
	title,
	instruction,
	save,
	isCurrent
}: {
	chatId: string;
	canvasId: string;
	content: string;
	selection: string;
	title: string;
	instruction: string;
	save: () => Promise<boolean>;
	isCurrent: () => boolean;
}) {
	const selected = canvasSelectionSource(content, selection);
	if (!selected) throw new Error('Select a unique passage of at most 8,000 characters.');
	if (!(await save()) || !isCurrent() || get(activeChatId) !== chatId) return false;
	const saved = await selectTransientCanvasDocument(localStorage.token, chatId, canvasId);
	if (!isCurrent() || get(activeChatId) !== chatId) return false;
	if (saved.content !== content || !saved.contentHash)
		throw new Error(
			'The document changed while preparing this selection. Please select the passage again.'
		);
	return window.dispatchEvent(
		new CustomEvent(WORKSPACE_ASK_AI_EVENT, {
			cancelable: true,
			detail: {
				chatId,
				title,
				prompt: instruction.trim(),
				focus: {
					kind: 'canvas',
					id: canvasId,
					selection: {
						text: selected,
						displayText: selection.trim(),
						contentHash: saved.contentHash
					}
				}
			}
		})
	);
}
