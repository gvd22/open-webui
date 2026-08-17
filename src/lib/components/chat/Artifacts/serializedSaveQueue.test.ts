import { describe, expect, it, vi } from 'vitest';

import {
	createSerializedSaveQueue,
	flushWorkspaceSaveBarrier,
	registerWorkspaceSaveBarrier,
	resetWorkspaceSaveVersion,
	runWorkspaceOptimisticSave
} from './serializedSaveQueue';

const deferred = () => {
	let resolve!: () => void;
	const promise = new Promise<void>((done) => {
		resolve = done;
	});
	return { promise, resolve };
};

describe('createSerializedSaveQueue', () => {
	it('coalesces pending values and never overlaps saves', async () => {
		vi.useFakeTimers();
		const first = deferred();
		const calls: string[] = [];
		let active = 0;
		let maxActive = 0;
		const queue = createSerializedSaveQueue(async (value: string) => {
			calls.push(value);
			active += 1;
			maxActive = Math.max(maxActive, active);
			if (value === 'first') await first.promise;
			active -= 1;
		}, 10);

		queue.enqueue('first');
		await vi.advanceTimersByTimeAsync(10);
		queue.enqueue('second');
		queue.enqueue('latest');
		await vi.advanceTimersByTimeAsync(10);

		expect(calls).toEqual(['first']);
		first.resolve();
		await queue.flush();

		expect(calls).toEqual(['first', 'latest']);
		expect(maxActive).toBe(1);
		vi.useRealTimers();
	});

	it('flushes a pending debounced value immediately', async () => {
		vi.useFakeTimers();
		const save = vi.fn(async () => undefined);
		const queue = createSerializedSaveQueue(save, 500);

		queue.enqueue('pending');
		await queue.flush();

		expect(save).toHaveBeenCalledOnce();
		expect(save).toHaveBeenCalledWith('pending');
		vi.useRealTimers();
	});

	it('flushes the focused workspace object and any other pending editor', async () => {
		const canvas = vi.fn(async () => true);
		const preview = vi.fn(async () => true);
		const unregisterCanvas = registerWorkspaceSaveBarrier(
			{ kind: 'canvas', id: 'canvas-1' },
			canvas
		);
		const unregisterPreview = registerWorkspaceSaveBarrier(
			{ kind: 'web_preview', id: 'preview-1' },
			preview
		);

		await expect(flushWorkspaceSaveBarrier({ kind: 'web_preview', id: 'preview-1' })).resolves.toBe(
			true
		);
		expect(preview).toHaveBeenCalledOnce();
		expect(canvas).toHaveBeenCalledOnce();

		unregisterCanvas();
		unregisterPreview();
	});

	it('flushes pending editors after the workspace pane has closed', async () => {
		const canvas = vi.fn(async () => true);
		const unregister = registerWorkspaceSaveBarrier(
			{ kind: 'canvas', id: 'canvas-closed' },
			canvas
		);

		await expect(flushWorkspaceSaveBarrier()).resolves.toBe(true);
		expect(canvas).toHaveBeenCalledOnce();

		unregister();
	});

	it('does not let an old component unregister its replacement barrier', async () => {
		const oldBarrier = vi.fn(async () => true);
		const currentBarrier = vi.fn(async () => false);
		const unregisterOld = registerWorkspaceSaveBarrier(
			{ kind: 'canvas', id: 'canvas-1' },
			oldBarrier
		);
		const unregisterCurrent = registerWorkspaceSaveBarrier(
			{ kind: 'canvas', id: 'canvas-1' },
			currentBarrier
		);

		unregisterOld();
		await expect(flushWorkspaceSaveBarrier({ kind: 'canvas', id: 'canvas-1' })).resolves.toBe(
			false
		);

		unregisterCurrent();
	});

	it('serializes and advances optimistic versions across renderer remounts', async () => {
		const target = { kind: 'web_preview' as const, id: 'preview-remount' };
		const first = deferred();
		const effectiveVersions: Array<{ updatedAt?: number; contentHash?: string }> = [];
		let active = 0;
		let maxActive = 0;
		const save = async (updatedAt: number, contentHash: string) =>
			runWorkspaceOptimisticSave(
				target,
				{ updatedAt: 1, contentHash: 'hash-1' },
				async (version) => {
					effectiveVersions.push(version);
					active += 1;
					maxActive = Math.max(maxActive, active);
					if (updatedAt === 2) await first.promise;
					active -= 1;
					return { updatedAt, contentHash };
				}
			);

		const firstSave = save(2, 'hash-2');
		const remountedSave = save(3, 'hash-3');
		first.resolve();
		await Promise.all([firstSave, remountedSave]);

		expect(effectiveVersions).toEqual([
			{ updatedAt: 1, contentHash: 'hash-1' },
			{ updatedAt: 2, contentHash: 'hash-2' }
		]);
		expect(maxActive).toBe(1);
		resetWorkspaceSaveVersion(target);
	});
});
