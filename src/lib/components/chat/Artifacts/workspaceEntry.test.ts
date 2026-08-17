import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const readComponent = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

describe('workspace entry behavior', () => {
	it('routes the header button through the runtime-aware default target', () => {
		const chat = readComponent('../Chat.svelte');
		const navbar = readComponent('../Navbar.svelte');

		expect(chat).toContain('workspaceDefaultContentId = getDefaultWorkspaceContentId(');
		expect(chat).toContain('{workspaceDefaultContentId}');
		expect(navbar).toContain('export let workspaceDefaultContentId = WORKSPACE_LAUNCHER_ID;');
		expect(navbar).toContain('artifactCode.set(workspaceDefaultContentId);');
	});

	it('does not present the add menu for a Files-only Pyodide workspace', () => {
		const tabs = readComponent('WorkspaceTabs.svelte');

		expect(tabs).toContain('hasWorkspaceAddActions(terminalId)');
		expect(tabs).not.toContain('hasWorkspaceAddActions(terminalId, filesAvailable)');
	});
});
