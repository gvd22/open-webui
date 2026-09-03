import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const readComponent = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

describe('workspace entry behavior', () => {
	it('routes the header button through the runtime-aware default target', () => {
		const chat = readComponent('../Chat.svelte');
		const navbar = readComponent('../Navbar.svelte');

		expect(chat).toContain('workspaceDefaultContentId = getDefaultWorkspaceContentId()');
		expect(chat).toContain('{workspaceDefaultContentId}');
		expect(navbar).toContain('export let workspaceDefaultContentId = WORKSPACE_FILES_ID;');
		expect(navbar).toContain('artifactCode.set(workspaceDefaultContentId);');
	});

	it('does not present the add menu for a Files-only Pyodide workspace', () => {
		const tabs = readComponent('WorkspaceTabs.svelte');

		expect(tabs).not.toContain('Add to workspace');
		expect(tabs).not.toContain('workspace-add-menu');
	});

	it('keeps the desktop workspace fixed on the right without a move control', () => {
		const navbar = readComponent('../Navbar.svelte');
		const controls = readComponent('../ChatControls.svelte');
		const tabs = readComponent('WorkspaceTabs.svelte');

		expect(navbar).toContain('<Sidebar className="size-4" strokeWidth="1.5" side="right" />');
		expect(controls).toContain('side="right"');
		expect(controls).not.toContain('open-webui.workspace.side');
		expect(tabs).not.toContain('Move workspace to left');
		expect(tabs).not.toContain('Move workspace to right');
	});

	it('shows outputs directly with content-specific icons', () => {
		const outputs = readComponent('../WorkspaceOutputsMenu.svelte');

		expect(outputs).not.toContain("$i18n.t('Workspace')");
		expect(outputs).toContain('<Note className="size-4" />');
		expect(outputs).toContain('<GlobeAlt className="size-4" />');
		expect(outputs).toContain('<FileTypeIcon name={file.name} type="file" size={16} />');
	});
});
