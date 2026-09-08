import { describe, expect, it, vi } from 'vitest';
import { get, writable } from 'svelte/store';
import type { WorkspaceOutputFile } from '$lib/stores/artifactWorkspace';
import {
	createWorkspaceOutputCatalog,
	createWorkspaceOutputFile,
	createWorkspaceOutputOpenDetail,
	isKnownWorkspaceOutputPath,
	isWorkspaceOutputPath,
	mergeWorkspaceOutputFiles,
	normalizeWorkspaceOutputFiles,
	parseWorkspaceOutputSnapshots,
	reassignWorkspaceOutputMessageFiles,
	resolveWorkspaceOutputFile
} from './workspaceOutputs';

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('chat-scoped Pyodide output catalog', () => {
	it('preserves the durable upload id when opening a message output card', () => {
		expect(
			createWorkspaceOutputOpenDetail({
				workspace_path: '/mnt/uploads/report.pdf',
				id: 'file-123',
				content_type: 'application/pdf',
				size: 42
			})
		).toEqual({
			path: '/mnt/uploads/report.pdf',
			fileId: 'file-123',
			contentType: 'application/pdf',
			size: 42
		});
	});

	it('accepts document outputs only inside the Pyodide uploads directory', () => {
		expect(isWorkspaceOutputPath('/mnt/uploads/report.pdf')).toBe(true);
		expect(isWorkspaceOutputPath('/mnt/uploads/table.xlsx')).toBe(true);
		expect(isWorkspaceOutputPath('/workspace/report.pdf')).toBe(false);
		expect(isWorkspaceOutputPath('/mnt/uploads/index.html')).toBe(false);
		expect(isWorkspaceOutputPath('/mnt/uploads/bad\nreport.pdf')).toBe(false);
		expect(isWorkspaceOutputPath('/mnt/uploads/../private.pdf')).toBe(false);
		expect(isWorkspaceOutputPath('/mnt/uploads//report.pdf')).toBe(false);
	});

	it('deduplicates a path and keeps the newest metadata', () => {
		const first = createWorkspaceOutputFile('/mnt/uploads/report.pdf', { updatedAt: 10 });
		const second = createWorkspaceOutputFile('/mnt/uploads/report.pdf', {
			page: 3,
			updatedAt: 20
		});
		expect(mergeWorkspaceOutputFiles([first!], [second])).toEqual([
			expect.objectContaining({ path: '/mnt/uploads/report.pdf', page: 3, updatedAt: 20 })
		]);
	});

	it('normalizes persisted chat data and ignores invalid entries', () => {
		expect(
			normalizeWorkspaceOutputFiles([
				{ path: '/mnt/uploads/deck.pptx', updatedAt: 10 },
				{ path: '/etc/private.pdf', updatedAt: 20 }
			])
		).toEqual([
			expect.objectContaining({
				path: '/mnt/uploads/deck.pptx',
				name: 'deck.pptx',
				source: 'pyodide'
			})
		]);
	});

	it('keeps durable snapshot metadata across runtime refreshes', () => {
		const snapshot = createWorkspaceOutputFile('/mnt/uploads/deck.pptx', {
			fileId: 'file-1',
			messageId: 'message-1',
			originChatId: 'chat-1',
			contentType: 'application/pptx',
			size: 42,
			persistedAt: 20,
			updatedAt: 10
		})!;
		const refresh = createWorkspaceOutputFile('/mnt/uploads/deck.pptx', { updatedAt: 30 })!;

		expect(mergeWorkspaceOutputFiles([snapshot], [refresh])).toEqual([
			expect.objectContaining({ fileId: 'file-1', size: 42, updatedAt: 30 })
		]);
	});

	it('resolves only catalogued paths', () => {
		const output = createWorkspaceOutputFile('/mnt/uploads/report.pdf')!;
		expect(isKnownWorkspaceOutputPath([output], output.path)).toBe(true);
		expect(resolveWorkspaceOutputFile([output], output.path)).toBe(output);
		expect(resolveWorkspaceOutputFile([output], '/mnt/uploads/missing.pdf')).toBeNull();
	});

	it('distinguishes atomic snapshots from legacy file events', () => {
		const data = new TextEncoder().encode('first').buffer;
		const atomic = parseWorkspaceOutputSnapshots([
			{ path: '/mnt/uploads/report.pdf', data },
			{ path: '/etc/private.pdf', data },
			{ path: '/mnt/uploads/broken.pdf', data: 'not-bytes' }
		]);

		expect(atomic.atomic).toBe(true);
		expect(atomic.files.get('/mnt/uploads/report.pdf')).toBe(data);
		expect(atomic.files.size).toBe(1);
		expect(parseWorkspaceOutputSnapshots(undefined)).toEqual({
			atomic: false,
			files: new Map()
		});
	});

	it('moves a persisted output reference to exactly one message', () => {
		const oldReference = {
			source: 'workspace-output',
			workspace_path: '/mnt/uploads/report.pdf',
			id: 'old-file'
		};
		const newReference = { ...oldReference, id: 'new-file' };
		const messages = {
			first: { files: [oldReference, { source: 'upload', id: 'ordinary-file' }] },
			second: { files: [] },
			malformed: 'not-a-message'
		};

		const result = reassignWorkspaceOutputMessageFiles(
			messages,
			'/mnt/uploads/report.pdf',
			'second',
			newReference
		);

		expect(result.first).toEqual({ files: [{ source: 'upload', id: 'ordinary-file' }] });
		expect(result.second).toEqual({ files: [newReference] });
		expect(result.malformed).toBe('not-a-message');
	});

	it('persists records and deletes while updating the UI optimistically', async () => {
		const files = writable<WorkspaceOutputFile[]>([]);
		const persist = vi.fn(async (_chatId, mutation) => {
			if (mutation.remove?.length) return [];
			return mutation.upsert ?? [];
		});
		const onError = vi.fn();
		const catalog = createWorkspaceOutputCatalog(files, persist, onError);
		catalog.sync('chat-1', []);

		expect(catalog.record('chat-1', '/mnt/uploads/report.pdf')).toBe(true);
		expect(get(files)).toHaveLength(1);
		await tick();
		expect(persist).toHaveBeenCalledWith('chat-1', {
			upsert: [expect.objectContaining({ path: '/mnt/uploads/report.pdf' })]
		});

		catalog.applyPyodideChange('chat-1', {
			chatId: 'chat-1',
			kind: 'deleted',
			paths: ['/mnt/uploads/report.pdf']
		});
		expect(get(files)).toEqual([]);
		await tick();
		expect(onError).not.toHaveBeenCalled();
	});

	it('keeps a durable snapshot when its browser-local working copy is deleted', async () => {
		const snapshot = createWorkspaceOutputFile('/mnt/uploads/report.pdf', {
			fileId: 'file-1',
			originChatId: 'chat-1'
		})!;
		const files = writable<WorkspaceOutputFile[]>([]);
		const persist = vi.fn(async () => []);
		const catalog = createWorkspaceOutputCatalog(files, persist, vi.fn());
		catalog.sync('chat-1', [snapshot]);

		catalog.applyPyodideChange('chat-1', {
			chatId: 'chat-1',
			kind: 'deleted',
			paths: [snapshot.path]
		});

		expect(get(files)).toEqual([snapshot]);
		await tick();
		expect(persist).not.toHaveBeenCalled();
	});

	it('does not hide persistence failures', async () => {
		const files = writable<WorkspaceOutputFile[]>([]);
		const error = new Error('offline');
		const onError = vi.fn();
		const onConfirmed = vi.fn();
		const onFailed = vi.fn();
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
		const catalog = createWorkspaceOutputCatalog(
			files,
			async () => {
				throw error;
			},
			onError
		);
		catalog.sync('chat-1', []);
		catalog.record('chat-1', '/mnt/uploads/report.pdf', {}, { onConfirmed, onFailed });
		expect(get(files)).toHaveLength(1);
		expect(onConfirmed).not.toHaveBeenCalled();
		expect(onFailed).not.toHaveBeenCalled();
		await tick();
		expect(onError).toHaveBeenCalledWith(error);
		expect(onConfirmed).not.toHaveBeenCalled();
		expect(onFailed).toHaveBeenCalledWith(error);
		expect(consoleError).toHaveBeenCalled();
		expect(get(files)).toEqual([]);
		consoleError.mockRestore();
	});

	it('confirms a record only after the server has persisted it', async () => {
		const files = writable<WorkspaceOutputFile[]>([]);
		let release: (() => void) | undefined;
		const pending = new Promise<void>((resolve) => (release = resolve));
		const onConfirmed = vi.fn();
		const onFailed = vi.fn();
		const output = createWorkspaceOutputFile('/mnt/uploads/report.pdf')!;
		const catalog = createWorkspaceOutputCatalog(
			files,
			async () => {
				await pending;
				return [output];
			},
			vi.fn()
		);
		catalog.sync('chat-1', []);

		catalog.record('chat-1', output.path, output, { onConfirmed, onFailed });
		await tick();
		expect(onConfirmed).not.toHaveBeenCalled();

		release?.();
		await tick();
		expect(onConfirmed).toHaveBeenCalledOnce();
		expect(onFailed).not.toHaveBeenCalled();
	});

	it('keeps a confirmed record when its local confirmation callback fails', async () => {
		const files = writable<WorkspaceOutputFile[]>([]);
		const output = createWorkspaceOutputFile('/mnt/uploads/report.pdf')!;
		const onError = vi.fn();
		const onFailed = vi.fn();
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
		const catalog = createWorkspaceOutputCatalog(files, async () => [output], onError);
		catalog.sync('chat-1', []);

		catalog.record('chat-1', output.path, output, {
			onConfirmed: () => {
				throw new Error('local UI callback failed');
			},
			onFailed
		});
		await tick();

		expect(get(files)).toEqual([output]);
		expect(onFailed).not.toHaveBeenCalled();
		expect(onError).not.toHaveBeenCalled();
		expect(consoleError).toHaveBeenCalledWith(
			'Workspace output confirmation callback failed',
			expect.any(Error)
		);
		consoleError.mockRestore();
	});

	it('rolls back a failed background mutation without replacing the active chat', async () => {
		const active = createWorkspaceOutputFile('/mnt/uploads/active.pdf')!;
		const confirmed = createWorkspaceOutputFile('/mnt/uploads/confirmed.pdf')!;
		const files = writable<WorkspaceOutputFile[]>([]);
		const catalog = createWorkspaceOutputCatalog(
			files,
			async () => {
				throw new Error('offline');
			},
			vi.fn()
		);
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
		catalog.sync('chat-background', [confirmed]);
		catalog.sync('chat-active', [active]);

		catalog.record('chat-background', '/mnt/uploads/phantom.pdf');
		await tick();
		expect(get(files)).toEqual([active]);

		catalog.sync('chat-background', [confirmed]);
		expect(get(files)).toEqual([confirmed]);
		consoleError.mockRestore();
	});

	it('serializes rapid catalog mutations in their original order', async () => {
		const files = writable<WorkspaceOutputFile[]>([]);
		const calls: string[] = [];
		let releaseFirst: (() => void) | undefined;
		const firstPending = new Promise<void>((resolve) => (releaseFirst = resolve));
		const persist = vi.fn(async (_chatId, mutation) => {
			const path = mutation.upsert?.[0]?.path ?? mutation.remove?.[0] ?? '';
			calls.push(`start:${path}`);
			if (calls.length === 1) await firstPending;
			calls.push(`end:${path}`);
			return mutation.upsert ?? [];
		});
		const catalog = createWorkspaceOutputCatalog(files, persist, vi.fn());
		catalog.sync('chat-1', []);

		catalog.record('chat-1', '/mnt/uploads/first.pdf');
		catalog.record('chat-1', '/mnt/uploads/second.pdf');
		await tick();
		expect(calls).toEqual(['start:/mnt/uploads/first.pdf']);

		releaseFirst?.();
		await tick();
		await tick();
		expect(calls).toEqual([
			'start:/mnt/uploads/first.pdf',
			'end:/mnt/uploads/first.pdf',
			'start:/mnt/uploads/second.pdf',
			'end:/mnt/uploads/second.pdf'
		]);
	});

	it('does not apply an older response over a newer optimistic mutation', async () => {
		const files = writable<WorkspaceOutputFile[]>([]);
		let releaseFirst: (() => void) | undefined;
		let releaseSecond: (() => void) | undefined;
		const firstPending = new Promise<void>((resolve) => (releaseFirst = resolve));
		const secondPending = new Promise<void>((resolve) => (releaseSecond = resolve));
		let call = 0;
		const first = createWorkspaceOutputFile('/mnt/uploads/first.pdf', { updatedAt: 1 })!;
		const second = createWorkspaceOutputFile('/mnt/uploads/second.pdf', { updatedAt: 2 })!;
		const persist = vi.fn(async () => {
			call += 1;
			if (call === 1) {
				await firstPending;
				return [first];
			}
			await secondPending;
			return [first, second];
		});
		const catalog = createWorkspaceOutputCatalog(files, persist, vi.fn());
		catalog.sync('chat-1', []);

		catalog.record('chat-1', first.path, first);
		catalog.record('chat-1', second.path, second);
		expect(get(files).map((item) => item.path)).toEqual([second.path, first.path]);

		releaseFirst?.();
		await tick();
		await tick();
		expect(call).toBe(2);
		expect(get(files).map((item) => item.path)).toEqual([second.path, first.path]);

		releaseSecond?.();
		await tick();
	});

	it('rolls back only to the last successful queued mutation', async () => {
		const files = writable<WorkspaceOutputFile[]>([]);
		const first = createWorkspaceOutputFile('/mnt/uploads/first.pdf', { updatedAt: 1 })!;
		const second = createWorkspaceOutputFile('/mnt/uploads/second.pdf', { updatedAt: 2 })!;
		let call = 0;
		const catalog = createWorkspaceOutputCatalog(
			files,
			async () => {
				call += 1;
				if (call === 1) return [first];
				throw new Error('second save failed');
			},
			vi.fn()
		);
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
		catalog.sync('chat-1', []);

		catalog.record('chat-1', first.path, first);
		catalog.record('chat-1', second.path, second);
		await tick();
		await tick();
		await tick();

		expect(get(files)).toEqual([first]);
		consoleError.mockRestore();
	});

	it('does not replace optimistic state with stale hydration while a save is pending', async () => {
		const files = writable<WorkspaceOutputFile[]>([]);
		let release: (() => void) | undefined;
		const pending = new Promise<void>((resolve) => (release = resolve));
		const output = createWorkspaceOutputFile('/mnt/uploads/report.pdf')!;
		const catalog = createWorkspaceOutputCatalog(
			files,
			async () => {
				await pending;
				return [output];
			},
			vi.fn()
		);
		catalog.sync('chat-1', []);
		catalog.record('chat-1', output.path, output);

		catalog.sync('chat-1', []);
		expect(get(files)).toEqual([output]);

		release?.();
		await tick();
	});

	it('restores a pending optimistic catalog after switching away and back', async () => {
		const files = writable<WorkspaceOutputFile[]>([]);
		let release: (() => void) | undefined;
		const pending = new Promise<void>((resolve) => (release = resolve));
		const first = createWorkspaceOutputFile('/mnt/uploads/first.pdf')!;
		const second = createWorkspaceOutputFile('/mnt/uploads/second.pdf')!;
		const catalog = createWorkspaceOutputCatalog(
			files,
			async () => {
				await pending;
				return [first];
			},
			vi.fn()
		);
		catalog.sync('chat-1', []);
		catalog.record('chat-1', first.path, first);

		catalog.sync('chat-2', [second]);
		expect(get(files)).toEqual([second]);
		catalog.sync('chat-1', []);
		expect(get(files)).toEqual([first]);

		release?.();
		await tick();
	});

	it('does not let a slow save in one chat block another chat', async () => {
		const files = writable<WorkspaceOutputFile[]>([]);
		let releaseFirst: (() => void) | undefined;
		const firstPending = new Promise<void>((resolve) => (releaseFirst = resolve));
		const completed: string[] = [];
		const catalog = createWorkspaceOutputCatalog(
			files,
			async (chatId, mutation) => {
				if (chatId === 'chat-1') await firstPending;
				completed.push(chatId);
				return mutation.upsert ?? [];
			},
			vi.fn()
		);
		catalog.sync('chat-2', []);

		catalog.record('chat-1', '/mnt/uploads/slow.pdf');
		catalog.record('chat-2', '/mnt/uploads/fast.pdf');
		await tick();
		expect(completed).toEqual(['chat-2']);

		releaseFirst?.();
		await tick();
		expect(completed).toEqual(['chat-2', 'chat-1']);
	});

	it('ignores Pyodide events from another chat', () => {
		const files = writable<WorkspaceOutputFile[]>([]);
		const catalog = createWorkspaceOutputCatalog(files, async () => [], vi.fn());
		catalog.sync('chat-1', []);
		catalog.applyPyodideChange('chat-1', {
			chatId: 'chat-2',
			paths: ['/mnt/uploads/other.pdf']
		});
		expect(get(files)).toEqual([]);
	});

	it('persists a background output without replacing the active chat catalog', async () => {
		const active = createWorkspaceOutputFile('/mnt/uploads/active.pdf', {
			fileId: 'active-file'
		})!;
		const files = writable<WorkspaceOutputFile[]>([]);
		const persist = vi.fn(async (_chatId, mutation) => mutation.upsert ?? []);
		const catalog = createWorkspaceOutputCatalog(files, persist, vi.fn());
		catalog.sync('chat-active', [active]);

		catalog.record('chat-background', '/mnt/uploads/background.pdf', {
			fileId: 'background-file',
			originChatId: 'chat-background'
		});

		await tick();
		expect(persist).toHaveBeenCalledWith('chat-background', {
			upsert: [expect.objectContaining({ fileId: 'background-file' })]
		});
		expect(get(files)).toEqual([active]);
	});

	it('persists a background deletion without replacing the active chat catalog', async () => {
		const active = createWorkspaceOutputFile('/mnt/uploads/active.pdf')!;
		const files = writable<WorkspaceOutputFile[]>([]);
		const persist = vi.fn(async () => []);
		const catalog = createWorkspaceOutputCatalog(files, persist, vi.fn());
		catalog.sync('chat-active', [active]);

		catalog.applyPyodideChange('chat-background', {
			chatId: 'chat-background',
			kind: 'deleted',
			paths: ['/mnt/uploads/background.pdf']
		});

		await tick();
		expect(persist).toHaveBeenCalledWith('chat-background', {
			remove: ['/mnt/uploads/background.pdf']
		});
		expect(get(files)).toEqual([active]);
	});
});
