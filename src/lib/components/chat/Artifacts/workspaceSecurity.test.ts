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
		const artifacts = source('../Artifacts.svelte');

		expect(artifacts).toContain('open-webui.workspace.tabs.v');
		expect(artifacts).toContain('closedWorkspaceContentIds');
		expect(artifacts).toContain('workspaceContentOrder');
		expect(artifacts).toContain('item !== WORKSPACE_LAUNCHER_ID');
		expect(artifacts).toContain('workspaceOpenRequestId.subscribe');
		expect(artifacts).toContain("workspaceRuntime.kind === 'terminal' ? openedFileContents : []");
		expect(artifacts).toContain("console.warn('Unable to persist workspace tab state'");
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
		for (const relativePath of [
			'../Messages/CanvasActivity.svelte',
			'../Messages/CanvasPreview.svelte',
			'../Messages/WebPreviewActivity.svelte',
			'../Messages/WebPreviewCard.svelte'
		]) {
			expect(source(relativePath)).toContain('workspaceOpenRequestId.set');
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
