import { readFileSync } from 'node:fs';
import { compile } from 'svelte/compiler';
import { describe, expect, it } from 'vitest';

const readComponent = (name: string) => readFileSync(new URL(name, import.meta.url), 'utf8');

describe('workspace document viewer accessibility contract', () => {
	it('removes inactive document panels from pixels, focus order, and the accessibility tree', () => {
		const source = readComponent('WorkspaceDocumentPanels.svelte');

		expect(source).toContain(
			'hidden={selectedContentId !== getWorkspaceContentId(content, index)}'
		);
		expect(source).not.toContain('class:invisible={selectedContentId');
	});

	it('renders only the selected document viewer and leaves inactive owners empty', () => {
		const source = readComponent('WorkspaceDocumentPanels.svelte');

		expect(source).toContain(
			'hidden={selectedContentId !== getWorkspaceContentId(content, index)}'
		);
		expect(source).toContain('{#if selectedContentId === getWorkspaceContentId(content, index)}');
		expect(source).toContain('id={`workspace-panel-${index}`}');
		expect(source).not.toContain('<div class="absolute inset-0"></div>');
	});

	it('falls back to the Files preview unless the document viewer accepts the file', () => {
		const artifacts = readComponent('WorkspaceHost.svelte');
		const pyodideFiles = readComponent('../PyodideFileNav.svelte');

		expect(artifacts).toContain('return false;');
		expect(artifacts).toContain('return true;');
		expect(pyodideFiles).toContain(
			'export let onOpenFile: (path: string) => boolean = () => false;'
		);
		expect(pyodideFiles).toMatch(/onOpenFile\(filePath\)\)\s*return;/);
	});

	it('passes a workspace document target page to the selected document viewer', () => {
		const panels = readComponent('WorkspaceDocumentPanels.svelte');
		const viewer = readComponent('DocumentViewer/DocumentFileViewer.svelte');

		expect(panels).toContain('targetPage={content.targetPage ?? null}');
		expect(viewer).toContain('export let targetPage: number | null = null;');
		expect(viewer.match(/\{targetPage\}/g)).toHaveLength(2);
	});

	it('assigns exactly one existing tabpanel owner to every workspace tab', () => {
		const source = readComponent('WorkspaceHost.svelte');
		const documentPanels = readComponent('WorkspaceDocumentPanels.svelte');
		const tabs = readComponent('WorkspaceTabs.svelte');

		expect(tabs).toContain('aria-controls={`workspace-panel-${tab.index}`}');
		expect(source).toContain('<WorkspaceDocumentPanels');
		expect(source).not.toContain('<DocumentFileViewer');
		expect(documentPanels.match(/id=\{`workspace-panel-\$\{index\}`\}/g)).toHaveLength(1);
		expect(source).toMatch(
			/\{#if contents\[selectedContentIdx\]\.type !== 'workspace-file'\}\s*<div\s+id=\{workspacePanelId\}/
		);
		expect(source).toMatch(
			/\{#if content\.type !== 'workspace-file' && index !== selectedContentIdx\}\s*<div\s+id=\{`workspace-panel-\$\{index\}`\}/
		);
		expect(source).not.toContain("hidden={contents[selectedContentIdx].type === 'workspace-file'}");
	});

	it('validates PowerPoint before converting it with the shared upstream renderer', () => {
		const source = readComponent('../../common/OfficeDocumentPreview.svelte');

		expect(source.indexOf('await validatePptxArchive(candidate)')).toBeGreaterThan(-1);
		expect(source.indexOf('await validatePptxArchive(candidate)')).toBeLessThan(
			source.indexOf('await pptxToImages(candidate.slice(0))')
		);
		expect(source).toContain('<PptxPreview');
		expect(source).toContain("const XLSX = await import('xlsx')");
	});

	it('uses the shared Office renderer for Pyodide workspace documents', () => {
		const workspaceViewer = readComponent('DocumentViewer/DocumentFileViewer.svelte');

		expect(workspaceViewer).toContain('OfficeDocumentPreview');
		expect(workspaceViewer).not.toContain('WordDocumentViewer');
		expect(workspaceViewer).not.toContain('PowerPointDocumentViewer');
	});

	it('keeps the shared PowerPoint controls free of Svelte accessibility warnings', () => {
		const warnings = compile(readComponent('../../common/PptxPreview.svelte'), {
			generate: 'client'
		}).warnings.map((warning) => warning.code);

		expect(warnings.filter((code) => code.startsWith('a11y_'))).toEqual([]);
	});
});
