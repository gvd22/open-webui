import { describe, expect, it } from 'vitest';

import {
	getFileNavWorkspaceKey,
	readFileNavSessionState,
	saveFileNavSessionState
} from './session';

describe('FileNav session state', () => {
	it('isolates saved chats and refuses an unsaved shared workspace key', () => {
		const terminal = { id: 'terminal-1', url: 'http://terminal' };
		const first = getFileNavWorkspaceKey(terminal, 'chat-1');
		const second = getFileNavWorkspaceKey(terminal, 'chat-2');

		expect(first).not.toBe(second);
		expect(getFileNavWorkspaceKey(terminal, null)).toBeNull();
		expect(getFileNavWorkspaceKey(terminal, 'temporary:1')).toBeNull();

		saveFileNavSessionState(first!, {
			savedPath: '/one',
			fileRoot: null,
			expandedDirs: [],
			treeContents: []
		});
		expect(readFileNavSessionState(first)?.savedPath).toBe('/one');
		expect(readFileNavSessionState(second)).toBeNull();
	});
});
