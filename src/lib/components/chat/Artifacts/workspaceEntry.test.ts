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

	it('uses the mirrored sidebar control and persists a movable desktop workspace', () => {
		const navbar = readComponent('../Navbar.svelte');
		const controls = readComponent('../ChatControls.svelte');
		const tabs = readComponent('WorkspaceTabs.svelte');
		const panel = readComponent('../../common/ResizableSidePanel.svelte');

		expect(navbar).toContain(
			'<Sidebar className="size-4" strokeWidth="1.5" side={$workspacePanelSide} />'
		);
		expect(controls).toContain("localStorage.getItem('open-webui.workspace.side')");
		expect(controls).toContain('side={$workspacePanelSide}');
		expect(tabs).toContain("'Move workspace to left'");
		expect(tabs).toContain("'Move workspace to right'");
		expect(panel).toContain("order: {side === 'left' ? -1 : 0}");
	});
});
