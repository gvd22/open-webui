import { readWorkspaceText } from '$lib/pyodide/readWorkspaceText';

type WorkspaceRpcData = {
	runtime?: unknown;
	source_path?: unknown;
	max_bytes?: unknown;
	path?: unknown;
};

export const handleWorkspaceRpc = async (
	type: 'workspace:display_file' | 'workspace:read_runtime_file',
	data: WorkspaceRpcData,
	chatId: string,
	reply: (result: unknown) => void,
	getWorker: () => Worker
) => {
	try {
		if (type === 'workspace:display_file') {
			const { displayWorkspaceOutput } = await import('./workspaceDisplay');
			reply(await displayWorkspaceOutput(chatId, data.path));
		} else {
			if (data.runtime !== 'pyodide') throw new Error('No supported runtime is active.');
			const maxBytes = Math.min(Math.max(Number(data.max_bytes) || 0, 1), 512000);
			reply({
				content: await readWorkspaceText(getWorker(), String(data.source_path ?? ''), maxBytes)
			});
		}
	} catch (error) {
		reply({ error: error instanceof Error ? error.message : String(error) });
	}
};
