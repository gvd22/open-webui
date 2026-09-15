export const WORKSPACE_ASK_AI_EVENT = 'workspace:ask-ai';

// Unsaved drafts survive closing a workspace tab and a reload in this browser tab.
const drafts = new Map<string, unknown>();
export const draftKey = (userId: string, chatId: string, kind: string, id: string) =>
	`workspace-draft:${JSON.stringify([userId, chatId, kind, id])}`;
export const readConflictDraft = <T>(key: string): T | null => {
	if (drafts.has(key)) return drafts.get(key) as T;
	try {
		const saved = sessionStorage.getItem(key);
		return saved ? JSON.parse(saved) : ((drafts.get(key) as T) ?? null);
	} catch {
		return (drafts.get(key) as T) ?? null;
	}
};
export const keepConflictDraft = (key: string, draft: unknown) => {
	drafts.set(key, structuredClone(draft));
	try {
		sessionStorage.setItem(key, JSON.stringify(draft));
		return true;
	} catch {
		return false;
	}
};
export const clearConflictDraft = (key: string, savedDraft?: unknown) => {
	if (
		savedDraft !== undefined &&
		JSON.stringify(readConflictDraft(key)) !== JSON.stringify(savedDraft)
	)
		return;
	drafts.delete(key);
	try {
		sessionStorage.removeItem(key);
	} catch {
		/* Memory copy is already cleared. */
	}
};

// A linear, bounded comparison, not a version-history engine.
export const changedText = (before: string, after: string) => {
	let start = 0;
	while (start < before.length && start < after.length && before[start] === after[start]) start++;
	let end = 0;
	while (
		end < before.length - start &&
		end < after.length - start &&
		before[before.length - 1 - end] === after[after.length - 1 - end]
	)
		end++;
	const oldText = before.slice(start, before.length - end);
	const newText = after.slice(start, after.length - end);
	return {
		before: oldText.slice(0, 12000),
		after: newText.slice(0, 12000),
		truncated: oldText.length > 12000 || newText.length > 12000
	};
};

export const canvasSelection = (content: string, selected: string) => {
	if (!selected.trim() || selected.length > 8000) return null;
	const start = content.indexOf(selected);
	return start >= 0 && content.indexOf(selected, start + 1) < 0 ? selected : null;
};
