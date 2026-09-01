import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./PDFViewer.svelte', import.meta.url), 'utf8');

describe('PDF viewer load lifecycle contract', () => {
	it('commits an input only after its first page rendered', () => {
		expect(source.indexOf("dispatch('preview-rendered', data)")).toBeGreaterThan(
			source.indexOf('await renderAllPages();')
		);
		expect(source).toContain('if (token !== loadToken)');
		expect(source).toContain('pdfDoc = null;');
		expect(source).toContain('await candidatePdfDoc.destroy();');
	});

	it('cancels pending fetches and PDF.js loading tasks', () => {
		expect(source).toContain('const cancelPendingLoad = () => {');
		expect(source).toContain('fetchController?.abort();');
		expect(source).toContain('loadingTask?.destroy?.()');
		expect(source).toContain('signal: controller.signal');
		expect(source).toContain('cancelPendingLoad();');
	});
});
