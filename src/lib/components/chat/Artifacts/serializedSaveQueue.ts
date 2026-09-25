export const createSerializedSaveQueue = <T>(save: (value: T) => Promise<void>, delay = 500) => {
	let timer: ReturnType<typeof setTimeout> | null = null;
	let pending: T | null = null;
	let running: Promise<void> | null = null;

	const drain = async () => {
		while (pending !== null) {
			const next = pending;
			pending = null;
			await save(next);
		}
	};

	const flush = () => {
		if (timer) {
			clearTimeout(timer);
			timer = null;
		}
		if (!running) {
			running = drain().finally(() => {
				running = null;
				if (pending !== null) void flush();
			});
		}
		return running;
	};

	const enqueue = (value: T) => {
		pending = value;
		if (timer) clearTimeout(timer);
		timer = setTimeout(() => {
			timer = null;
			void flush();
		}, delay);
	};

	return { enqueue, flush };
};

export type WorkspaceSaveTarget = {
	chatId: string;
	kind: 'canvas' | 'web_preview';
	id: string;
};

type WorkspaceSaveBarrier = () => Promise<boolean>;

const workspaceSaveBarriers = new Map<string, WorkspaceSaveBarrier>();
const workspaceSaveKey = ({ chatId, kind, id }: WorkspaceSaveTarget) => `${chatId}:${kind}:${id}`;

export type WorkspaceSaveVersion = {
	updatedAt?: number;
	contentHash?: string;
};

type WorkspaceVersionChain = {
	base: WorkspaceSaveVersion;
	saved: WorkspaceSaveVersion;
};

const workspaceSaveLocks = new Map<string, Promise<void>>();
const workspaceVersionChains = new Map<string, WorkspaceVersionChain>();

export const runWorkspaceOptimisticSave = async <T extends WorkspaceSaveVersion>(
	target: WorkspaceSaveTarget,
	expected: WorkspaceSaveVersion,
	save: (effective: WorkspaceSaveVersion) => Promise<T>
): Promise<T> => {
	const key = workspaceSaveKey(target);
	const previous = workspaceSaveLocks.get(key) ?? Promise.resolve();
	let release = () => {};
	const current = new Promise<void>((resolve) => {
		release = resolve;
	});
	workspaceSaveLocks.set(key, current);

	await previous.catch(() => undefined);
	try {
		const chain = workspaceVersionChains.get(key);
		const effective =
			chain &&
			expected.updatedAt === chain.base.updatedAt &&
			expected.contentHash === chain.base.contentHash
				? chain.saved
				: expected;
		const result = await save(effective);
		workspaceVersionChains.set(key, {
			base: expected,
			saved: { updatedAt: result.updatedAt, contentHash: result.contentHash }
		});
		return result;
	} finally {
		release();
		if (workspaceSaveLocks.get(key) === current) workspaceSaveLocks.delete(key);
	}
};

export const resetWorkspaceSaveVersion = (
	target: WorkspaceSaveTarget,
	version?: WorkspaceSaveVersion
) => {
	const key = workspaceSaveKey(target);
	if (!version) workspaceVersionChains.delete(key);
	else workspaceVersionChains.set(key, { base: version, saved: version });
};

export const registerWorkspaceSaveBarrier = (
	target: WorkspaceSaveTarget,
	barrier: WorkspaceSaveBarrier
) => {
	const key = workspaceSaveKey(target);
	workspaceSaveBarriers.set(key, barrier);

	return () => {
		if (workspaceSaveBarriers.get(key) === barrier) workspaceSaveBarriers.delete(key);
	};
};

export const flushWorkspaceSaveBarrier = async (target?: WorkspaceSaveTarget) => {
	const targetKey = target ? workspaceSaveKey(target) : undefined;
	const barriers = [...workspaceSaveBarriers.entries()].sort(([left], [right]) =>
		left === targetKey ? -1 : right === targetKey ? 1 : 0
	);
	const results = await Promise.all(barriers.map(([, barrier]) => barrier()));
	return results.every(Boolean);
};
