import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./RichTextInput.svelte', import.meta.url), 'utf8');

describe('RichTextInput collaboration contract', () => {
	it('uses Yjs history without also registering StarterKit history', () => {
		expect(source).toContain('undoRedo: collaboration ? false : {}');
		expect(source).toContain('provider.getEditorExtension()');
	});
});
