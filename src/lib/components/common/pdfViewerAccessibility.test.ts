import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./PDFViewer.svelte', import.meta.url), 'utf8');

describe('PDF viewer accessibility contract', () => {
	it('announces the current page with a reactive region label', () => {
		expect(source).toContain('`PDF document, page ${currentPage} of ${pdfDoc?.numPages ?? 0}`');
		expect(source).toContain('`${itemLabel}, ${selectedPage} of ${pageCount}`');
	});
});
