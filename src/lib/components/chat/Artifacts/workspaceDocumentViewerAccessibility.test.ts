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

		expect(source).toContain('hidden={selectedContentId !== getWorkspaceContentId(content, index)}');
		expect(source).toContain('{#if selectedContentId === getWorkspaceContentId(content, index)}');
		expect(source).toContain('id={`workspace-panel-${index}`}');
		expect(source).not.toContain('<div class="absolute inset-0"></div>');
	});

	it('falls back to the Files preview unless the document viewer accepts the file', () => {
		const artifacts = readComponent('../Artifacts.svelte');
		const terminalFiles = readComponent('../FileNav.svelte');
		const pyodideFiles = readComponent('../PyodideFileNav.svelte');

		expect(artifacts).toContain('return false;');
		expect(artifacts).toContain('return true;');
		for (const source of [terminalFiles, pyodideFiles]) {
			expect(source).toContain('export let onOpenFile: (path: string) => boolean = () => false;');
			expect(source).toMatch(/onOpenFile\(filePath\)\)\s*return;/);
		}
	});

	it('assigns exactly one existing tabpanel owner to every workspace tab', () => {
		const source = readComponent('../Artifacts.svelte');
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

	it('keeps PowerPoint staging inert and off-canvas until it is committed', () => {
		const source = readComponent('DocumentViewer/PowerPointDocumentViewer.svelte');

		expect(source).toContain("candidateContainer.setAttribute('aria-hidden', 'true')");
		expect(source).toContain('candidateContainer.inert = true');
		expect(source).toContain("candidateContainer.style.transform = 'translateX(-200vw)'");
		expect(source).toContain("candidateContainer.removeAttribute('aria-hidden')");
		expect(source).toContain('candidateContainer.inert = false');
	});

	it('validates PowerPoint relationships before invoking the renderer', () => {
		const source = readComponent('DocumentViewer/PowerPointDocumentViewer.svelte');

		expect(source.indexOf('await validatePptxArchive(candidateData)')).toBeGreaterThan(-1);
		expect(source.indexOf('await validatePptxArchive(candidateData)')).toBeLessThan(
			source.indexOf('await PptxViewer.open(candidateData')
		);
	});

	it('makes the labelled PowerPoint stage itself the keyboard slider target', () => {
		const source = readComponent('DocumentViewer/PowerPointDocumentViewer.svelte');

		expect(source).toMatch(
			/bind:this=\{host\}\s+role="slider"[\s\S]*?aria-label=\{\$i18n\.t\('PowerPoint presentation'\)\}[\s\S]*?on:keydown=\{handlePresentationKeydown\}/
		);
		expect(source.match(/on:keydown=\{handlePresentationKeydown\}/g)).toHaveLength(1);
	});

	it('keeps the PowerPoint keyboard controls free of Svelte accessibility warnings', () => {
		const warnings = compile(readComponent('DocumentViewer/PowerPointDocumentViewer.svelte'), {
			generate: 'client'
		}).warnings.map((warning) => warning.code);

		expect(warnings.filter((code) => code.startsWith('a11y_'))).toEqual([]);
	});
});
