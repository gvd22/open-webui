import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = (relativePath: string) =>
	readFileSync(new URL(relativePath, import.meta.url), 'utf8');

describe('workspace security and configuration invariants', () => {
	it('isolates scripted local apps from the Open WebUI origin', () => {
		const portPreview = source('../FileNav/PortPreview.svelte');
		const sandbox = portPreview.match(/sandbox="([^"]+)"/)?.[1] ?? '';

		expect(sandbox).toContain('allow-scripts');
		expect(sandbox).not.toContain('allow-same-origin');
		expect(portPreview).toContain("credentials: 'include'");
		expect(portPreview).toContain('authenticated workspace proxy');
		expect(portPreview).toContain('getPortPreviewFrameBlockReason');
		expect(portPreview).toContain('Isolated preview');
	});

	it('persists only real per-chat workspace objects', () => {
		const workspace = source('./WorkspaceHost.svelte');
		const session = source('./workspaceSession.ts');

		expect(session).toContain('open-webui.workspace.tabs.v');
		expect(session).toContain('item !== WORKSPACE_LAUNCHER_ID');
		expect(session).toContain("console.warn('Unable to persist workspace tab state'");
		expect(workspace).toContain('closedWorkspaceContentIds');
		expect(workspace).toContain('workspaceContentOrder');
		expect(workspace).toContain('workspaceOpenRequestId.subscribe');
		expect(workspace).toContain('workspaceRuntime.files ? openedFileContents : []');
	});

	it('opens Pyodide Files once without reopening a manually closed tab', () => {
		const artifacts = source('./WorkspaceHost.svelte');

		expect(artifacts).toContain("workspaceRuntime.kind === 'pyodide'");
		expect(artifacts).toContain('!workspaceRuntime.shell');
		expect(artifacts).toContain('!filesOpened');
		expect(artifacts).toContain('!closedWorkspaceContentIds.has(WORKSPACE_FILES_ID)');
		expect(artifacts).toContain('openWorkspaceFiles();');
	});

	it('provides roving tab focus and menu keyboard semantics', () => {
		const tabs = source('./WorkspaceTabs.svelte');

		for (const key of ['ArrowLeft', 'ArrowRight', 'Home', 'End']) {
			expect(tabs).toContain(`event.key === '${key}'`);
		}
		expect(tabs).toContain('tabindex={tab.index === selectedIndex ? 0 : -1}');
		expect(tabs).toContain('role="menuitem"');
		expect(tabs).toContain('aria-controls="workspace-add-menu"');
		expect(tabs).toContain('closeTabAndFocus');
		expect(tabs).toContain('focusSelectedTab');
	});

	it('marks chat cards as explicit workspace-open requests', () => {
		const controller = source('../Messages/workspaceArtifactOpen.ts');
		expect(controller).toContain('workspaceOpenRequestId.set');

		for (const relativePath of [
			'../Messages/CanvasActivity.svelte',
			'../Messages/CanvasPreview.svelte',
			'../Messages/WebPreviewActivity.svelte',
			'../Messages/WebPreviewCard.svelte'
		]) {
			expect(source(relativePath)).toMatch(/open(Canvas|WebPreview)Artifact/);
		}
	});

	it('keeps Canvas and Web Preview opt-in and explains builtin dependencies', () => {
		const constants = source('../../../constants.ts');
		const capabilities = source('../../workspace/Models/Capabilities.svelte');
		const builtinTools = source('../../workspace/Models/BuiltinTools.svelte');

		expect(constants).toMatch(/canvas:\s*false/);
		expect(constants).toMatch(/web_preview:\s*false/);
		expect(capabilities).toContain('must be enabled for each model');
		expect(builtinTools).toContain('disabled={!isAvailable(tool)}');
	});
});
