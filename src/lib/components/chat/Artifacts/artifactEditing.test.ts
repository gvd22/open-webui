import { afterEach, expect, it, vi } from 'vitest';
import {
	canvasSelection,
	changedText,
	clearConflictDraft,
	draftKey,
	keepConflictDraft,
	readConflictDraft
} from './artifactEditing';
import { instrumentPreview, readPreviewDiagnostic } from './previewDiagnostics';

afterEach(() => {
	vi.unstubAllGlobals();
});

it('isolates and recovers drafts by user, chat and object without losing the memory fallback', () => {
	const values = new Map<string, string>();
	vi.stubGlobal('sessionStorage', {
		getItem: (key: string) => values.get(key),
		setItem: (key: string, value: string) => values.set(key, value),
		removeItem: (key: string) => values.delete(key)
	});
	const key = draftKey('u', 'chat-a', 'canvas', 'one');
	expect(keepConflictDraft(key, { content: 'my draft' })).toBe(true);
	expect(readConflictDraft(key)).toEqual({ content: 'my draft' });
	expect(readConflictDraft(draftKey('u', 'chat-b', 'canvas', 'one'))).toBeNull();
	expect(readConflictDraft(draftKey('other', 'chat-a', 'canvas', 'one'))).toBeNull();
	clearConflictDraft(key);
	expect(readConflictDraft(key)).toBeNull();
	vi.stubGlobal('sessionStorage', {
		getItem: () => JSON.stringify({ content: 'stale persisted draft' }),
		setItem: () => {
			throw Error('quota');
		}
	});
	expect(keepConflictDraft(key, { content: 'still here' })).toBe(false);
	expect(readConflictDraft(key)).toEqual({ content: 'still here' });
	clearConflictDraft(key);
});

it('allows only unique bounded selections and bounds comparisons', () => {
	expect(canvasSelection('Before unique after', 'unique')).toBe('unique');
	for (const selected of ['', ' ', 'repeat', 'absent', 'x'.repeat(8001)])
		expect(canvasSelection('repeat repeat', selected)).toBeNull();
	expect(changedText('before old after', 'before new after')).toEqual({
		before: 'old',
		after: 'new',
		truncated: false
	});
	expect(changedText('x'.repeat(15000), 'y'.repeat(15000))).toMatchObject({ truncated: true });
	expect(changedText('', 'x'.repeat(15000)).after).toHaveLength(12000);
});

it('treats preview diagnostics as bounded untrusted data from the current render', () => {
	expect(
		readPreviewDiagnostic(
			{ type: 'preview-diagnostic', channel: 'old', message: 'bad', file: '' },
			'new'
		)
	).toBeNull();
	expect(
		readPreviewDiagnostic(
			{ type: 'preview-diagnostic', channel: 'new', message: {}, file: '' },
			'new'
		)
	).toBeNull();
	expect(
		readPreviewDiagnostic(
			{
				type: 'preview-diagnostic',
				channel: 'new',
				message: 'x'.repeat(900),
				file: 'file.js?secret=hidden#hash'
			},
			'new'
		)
	).toEqual({ message: 'x'.repeat(600), file: 'file.js' });
	const html = instrumentPreview(
		'<html><head></head><body>ok</body></html>',
		'</script><img src=x>'
	);
	expect(html).toContain('\\u003c/script>');
	expect(html).not.toContain('</script><img');
	expect(html.indexOf('preview-diagnostic')).toBeLessThan(html.indexOf('</head>'));
});
