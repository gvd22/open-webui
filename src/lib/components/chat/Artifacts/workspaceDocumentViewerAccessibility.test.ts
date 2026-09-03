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
		const terminalFiles = readComponent('../FileNav.svelte');
		const pyodideFiles = readComponent('../PyodideFileNav.svelte');

		expect(artifacts).toContain('return false;');
		expect(artifacts).toContain('return true;');
		expect(terminalFiles.replace(/\s+/g, ' ')).toContain(
			'export let onOpenFile: (path: string, options?: { page?: number | null }) => boolean = () => false;'
		);
		expect(terminalFiles).toMatch(/onOpenFile\(filePath, \{ page: normalizeDocumentTargetPage/);
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
			/\{#if !\['workspace-file', 'workspace-browser'\]\.includes\(contents\[selectedContentIdx\]\.type\)\}\s*<div\s+id=\{workspacePanelId\}/
		);
		expect(source).toMatch(
			/\{#if content\.type !== 'workspace-file' && content\.type !== 'workspace-browser' && index !== selectedContentIdx\}\s*<div\s+id=\{`workspace-panel-\$\{index\}`\}/
		);
		expect(source).not.toContain(
			"hidden={['workspace-browser', 'workspace-file'].includes(contents[selectedContentIdx].type)}"
		);
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

	it('uses one shared Office renderer in Workspace, Files, and terminal outputs', () => {
		const workspaceViewer = readComponent('DocumentViewer/DocumentFileViewer.svelte');
		const fileNav = readComponent('../FileNav.svelte');
		const filePreview = readComponent('../FileNav/FilePreview.svelte');
		const terminalOutput = readComponent('../Messages/TerminalOutputFile.svelte');

		for (const source of [workspaceViewer, filePreview]) {
			expect(source).toContain('OfficeDocumentPreview');
			expect(source).not.toContain('WordDocumentViewer');
			expect(source).not.toContain('PowerPointDocumentViewer');
		}
		expect(terminalOutput).toContain('<FilePreview');
		expect(terminalOutput).toContain('{fileOfficeData}');
		expect(fileNav).toContain("['docx', 'pptx', 'xls', 'xlsx']");
		expect(fileNav).not.toContain("await import('mammoth')");
		expect(fileNav).not.toContain("await import('xlsx')");
		expect(fileNav).not.toContain('pptxToImages');
	});

	it('keeps the shared PowerPoint controls free of Svelte accessibility warnings', () => {
		const warnings = compile(readComponent('../../common/PptxPreview.svelte'), {
			generate: 'client'
		}).warnings.map((warning) => warning.code);

		expect(warnings.filter((code) => code.startsWith('a11y_'))).toEqual([]);
	});
});
