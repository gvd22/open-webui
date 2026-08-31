import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const fileNav = readFileSync(new URL('../FileNav.svelte', import.meta.url), 'utf8');
const entryRow = readFileSync(new URL('./FileEntryRow.svelte', import.meta.url), 'utf8');

describe('terminal File navigation contracts', () => {
	it('keys persisted navigation state by both terminal and saved chat', () => {
		expect(fileNav).toContain('const sessionStateByWorkspace = new Map');
		expect(fileNav).toContain(
			'isSavedChatId(id) ? `${terminal.id ?? terminal.url}\\u0000${id}` : null'
		);
		expect(fileNav).toMatch(/terminalChatContextPending\s*=\s*!!systemTerminal/);
		expect(fileNav).toContain('Save this chat to use files, terminal, and ports.');
	});

	it('commits a directory and its cwd only after the matching request succeeds', () => {
		const loadDir = fileNav.slice(
			fileNav.indexOf('\tconst loadDir = async'),
			fileNav.indexOf('\n\tconst fetchExpandedDir')
		);
		const failure = loadDir.indexOf('if (result === null)');
		const commit = loadDir.indexOf('currentPath = directory;');
		const persist = loadDir.indexOf(
			'void setCwd(terminal.url, terminal.key, directory, sessionId);'
		);

		expect(failure).toBeGreaterThan(-1);
		expect(commit).toBeGreaterThan(failure);
		expect(persist).toBeGreaterThan(commit);
		expect(loadDir).toContain('requestId !== directoryRequestSequence');
	});

	it('keeps preview state and search targets through a directory refresh', () => {
		expect(fileNav).toContain('preservePreview = selectedFile !== null || previewPort !== null');
		expect(fileNav).toContain('loadDir(currentPath, { preserveTree: true, preservePreview })');
		expect(fileNav).toContain(
			'options.preservePreview || filePreviewOpening || (selectedFile !== null && fileLoading)'
		);
		expect(fileNav).toContain('filePreviewOpening = true;');
		expect(fileNav).toContain('filePreviewOpening = false;');
		expect(fileNav).toContain(
			'Refresh listings without replacing an active preview or its search target.'
		);
	});

	it('passes the saved chat identity to every file and port preview', () => {
		expect(fileNav).toMatch(/<PortPreview[\s\S]*?\{chatId\}/);
		expect(fileNav).toMatch(/<FilePreview[\s\S]*?\{chatId\}/);
		expect(fileNav).toMatch(/<PortList[\s\S]*?\{chatId\}/);
	});

	it('forwards a native document page into the workspace file target', () => {
		expect(fileNav).toMatch(
			/onOpenFile\(filePath, \{ page: normalizeDocumentTargetPage\(options\.page\) \}\)/
		);
	});

	it('keeps a visible generic file click in Files when its directory refresh is stale', () => {
		const openEntry = fileNav.slice(
			fileNav.indexOf('\tconst openEntry = async'),
			fileNav.indexOf('\n\tlet appliedInitialFilePath')
		);
		expect(openEntry).toContain('await loadDir(parentPath);');
		expect(openEntry).not.toContain('if (!(await loadDir(parentPath))) return;');
		expect(openEntry).not.toContain("fileOpenTarget === 'files'");
		expect(openEntry).not.toContain('appliedInitialFilePath = filePath;');
	});
});

describe('file entry activation contract', () => {
	it('opens once from click while retaining touch long-press selection and keyboard activation', () => {
		expect(entryRow).toContain('on:click={handleClick}');
		expect(entryRow).not.toContain('on:mousedown={onMouseDown}');
		expect(entryRow).not.toContain('on:mouseup={onMouseUp}');
		expect(entryRow).not.toContain('pendingOpenTimer');
		const menuTrigger = entryRow.slice(
			entryRow.indexOf('<Dropdown'),
			entryRow.indexOf('<div slot="content">')
		);
		expect(menuTrigger).not.toContain('on:click|stopPropagation');
		expect(entryRow).toContain('on:pointerdown={onPointerDown}');
		expect(entryRow).toContain('on:pointerup={onPointerUp}');
		expect(entryRow).not.toContain('openedFromPointer');
		expect(entryRow).not.toContain('on:dragend=');
		expect(entryRow).toContain('if (didLongPress)');
		expect(entryRow).toContain('aria-expanded={menuOpen}');
	});
});
