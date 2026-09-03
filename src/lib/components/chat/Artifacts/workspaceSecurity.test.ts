import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = (relativePath: string) =>
	readFileSync(new URL(relativePath, import.meta.url), 'utf8');

describe('workspace security and configuration invariants', () => {
	it('persists only real per-chat workspace objects', () => {
		const workspace = source('./WorkspaceHost.svelte');
		const session = source('./workspaceSession.ts');

		expect(session).toContain('open-webui.workspace.tabs.v');
		expect(session).not.toContain('utilities');
		expect(session).toContain("console.warn('Unable to persist workspace tab state'");
		expect(workspace).toContain('closedWorkspaceContentIds');
		expect(workspace).toContain('workspaceContentOrder');
		expect(workspace).toContain('workspaceOpenRequestId.subscribe');
		expect(workspace).toContain('workspaceRuntime.files ? openedFileContents : []');
	});

	it('opens Pyodide Files once without reopening a manually closed tab', () => {
		const artifacts = source('./WorkspaceHost.svelte');

		expect(artifacts).toContain("workspaceRuntime.kind === 'pyodide'");
		expect(artifacts).toContain('!filesOpened');
		expect(artifacts).toContain('!closedWorkspaceContentIds.has(WORKSPACE_FILES_ID)');
		expect(artifacts).toContain('openWorkspaceFiles();');
	});

	it('provides roving tab focus without an unavailable add menu', () => {
		const tabs = source('./WorkspaceTabs.svelte');

		for (const key of ['ArrowLeft', 'ArrowRight', 'Home', 'End']) {
			expect(tabs).toContain(`event.key === '${key}'`);
		}
		expect(tabs).toContain('tabindex={tab.index === selectedIndex ? 0 : -1}');
		expect(tabs).not.toContain('role="menuitem"');
		expect(tabs).not.toContain('workspace-add-menu');
		expect(tabs).toContain('closeTabAndFocus');
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
