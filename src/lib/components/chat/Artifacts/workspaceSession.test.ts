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
	it('restores more than four open files without losing their saved references', () => {
		const target = storage();
		const openedFiles = Array.from({ length: 10 }, (_, index) => ({
			path: `/report-${index}.pdf`,
			fileId: `file-${index}`
		}));
		writeWorkspaceState(
			'chat-many-files',
			{
				order: openedFiles.map(({ path }) => `workspace:file:${path}`),
				closed: [],
				filesOpened: true,
				openedFiles
			},
			target
		);
		expect(readWorkspaceState('chat-many-files', target)?.openedFiles).toEqual(openedFiles);
	});

	it('round-trips bounded per-chat state', () => {
		const target = storage();
		expect(
			writeWorkspaceState(
				'chat-1',
				{
					order: ['workspace:files'],
					closed: [],
					filesOpened: true,
					openedFiles: [
						{ path: '/report.pdf', fileId: 'file-1' },
						{ path: '/notes.md' },
						{ path: '/data.json' },
						{ path: '/readme.txt' }
					]
				},
				target
			)
		).toBe(true);

		expect(readWorkspaceState('chat-1', target)).toMatchObject({
			filesOpened: true,
			openedFiles: [
				{ path: '/report.pdf', fileId: 'file-1' },
				{ path: '/notes.md' },
				{ path: '/data.json' },
				{ path: '/readme.txt' }
			]
		});
	});

	it('migrates legacy path-only state', () => {
		const target = storage({
			'open-webui.workspace.tabs.v1:chat-1': JSON.stringify({
				version: 1,
				order: [],
				closed: [],
				filesOpened: true,
				openedFiles: ['/report.pdf']
			})
		});

		expect(readWorkspaceState('chat-1', target)?.openedFiles).toEqual([{ path: '/report.pdf' }]);
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

	it('drops malformed and unbounded persisted values', () => {
		const target = storage({
			'open-webui.workspace.tabs.v2:chat-1': JSON.stringify({
				version: 2,
				order: ['workspace:files', 'workspace:files', `workspace:${'x'.repeat(3_000)}`, 'bad\n'],
				closed: ['canvas:one', 42],
				filesOpened: 'true',
				openedFiles: [
					{ path: '/report.pdf', fileId: 'file-1' },
					{ path: '/report.pdf', fileId: 'duplicate' },
					{ path: `/${'x'.repeat(2_000)}.pdf` },
					{ path: '/bad\n.pdf' },
					{ path: 'https://example.com/file.txt' },
					{ path: '/folder/' },
					{ path: '/other.pdf', fileId: 'x'.repeat(300) }
				]
			})
		});

		expect(readWorkspaceState('chat-1', target)).toMatchObject({
			order: ['workspace:files'],
			closed: ['canvas:one'],
			filesOpened: false,
			openedFiles: [{ path: '/report.pdf', fileId: 'file-1' }, { path: '/other.pdf' }]
		});
	});
});
