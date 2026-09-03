import { describe, expect, it, vi } from 'vitest';

import { readWorkspaceState, writeWorkspaceState } from './workspaceSession';

const storage = (initial: Record<string, string> = {}): Storage => {
	const values = new Map(Object.entries(initial));
	return {
		get length() {
			return values.size;
		},
		clear: () => values.clear(),
		getItem: (key) => values.get(key) ?? null,
		key: (index) => [...values.keys()][index] ?? null,
		removeItem: (key) => {
			values.delete(key);
		},
		setItem: (key, value) => {
			values.set(key, value);
		}
	};
};

describe('workspace session persistence', () => {
	it('round-trips bounded per-chat state', () => {
		const target = storage();
		expect(
			writeWorkspaceState(
				'chat-1',
				{
					order: ['workspace:files'],
					closed: [],
					filesOpened: true,
					openedFiles: ['/report.pdf']
				},
				target
			)
		).toBe(true);

		expect(readWorkspaceState('chat-1', target)).toMatchObject({
			filesOpened: true,
			openedFiles: ['/report.pdf']
		});
	});

	it('reports inaccessible storage and falls back to no restored state', () => {
		const error = new Error('storage unavailable');
		const blocked = storage();
		blocked.getItem = () => {
			throw error;
		};
		const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});

		expect(readWorkspaceState('chat-1', blocked)).toBeNull();
		expect(warning).toHaveBeenCalledWith('Unable to restore workspace tab state', error);
		warning.mockRestore();
	});
});
