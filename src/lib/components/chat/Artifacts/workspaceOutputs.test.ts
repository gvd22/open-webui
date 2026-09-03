import { describe, expect, it, vi } from 'vitest';
import { get, writable } from 'svelte/store';
import type { WorkspaceOutputFile } from '$lib/stores/artifactWorkspace';
import {
	createWorkspaceOutputCatalog,
	createWorkspaceOutputFile,
	isKnownWorkspaceOutputPath,
	isWorkspaceOutputPath,
	mergeWorkspaceOutputFiles,
	normalizeWorkspaceOutputFiles,
	resolveWorkspaceOutputFile
} from './workspaceOutputs';

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('chat-scoped Pyodide output catalog', () => {
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

	it('resolves only catalogued paths', () => {
		const output = createWorkspaceOutputFile('/mnt/uploads/report.pdf')!;
		expect(isKnownWorkspaceOutputPath([output], output.path)).toBe(true);
		expect(resolveWorkspaceOutputFile([output], output.path)).toBe(output);
		expect(resolveWorkspaceOutputFile([output], '/mnt/uploads/missing.pdf')).toBeNull();
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

	it('does not hide persistence failures', async () => {
		const files = writable<WorkspaceOutputFile[]>([]);
		const error = new Error('offline');
		const onError = vi.fn();
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
		const catalog = createWorkspaceOutputCatalog(
			files,
			async () => {
				throw error;
			},
			onError
		);
		catalog.sync('chat-1', []);
		catalog.record('chat-1', '/mnt/uploads/report.pdf');
		await tick();
		expect(onError).toHaveBeenCalledWith(error);
		expect(consoleError).toHaveBeenCalled();
		consoleError.mockRestore();
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
});
