import { describe, expect, it } from 'vitest';

import { getTerminalConnectionContextKey, isCurrentTerminalSocket } from './terminalConnection';

describe('terminal connection guards', () => {
	it('changes connection context when the chat scope changes', () => {
		expect(getTerminalConnectionContextKey('terminal-1', 'chat-1')).not.toBe(
			getTerminalConnectionContextKey('terminal-1', 'chat-2')
		);
	});

	it('rejects callbacks from replaced sockets or superseded requests', () => {
		const oldSocket = {};
		const currentSocket = {};

		expect(isCurrentTerminalSocket(currentSocket, currentSocket, 2, 2)).toBe(true);
		expect(isCurrentTerminalSocket(currentSocket, oldSocket, 2, 2)).toBe(false);
		expect(isCurrentTerminalSocket(currentSocket, currentSocket, 3, 2)).toBe(false);
	});
});
