import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const pagination = readFileSync(new URL('./DocumentPagination.svelte', import.meta.url), 'utf8');
const zoomControls = readFileSync(
	new URL('./DocumentZoomControls.svelte', import.meta.url),
	'utf8'
);
const pdfViewer = readFileSync(new URL('./PDFViewer.svelte', import.meta.url), 'utf8');
const presentationViewer = readFileSync(new URL('./PptxPreview.svelte', import.meta.url), 'utf8');
const wordViewer = readFileSync(new URL('./DocxPreview.svelte', import.meta.url), 'utf8');

describe('document pagination', () => {
	it('uses the shared Open WebUI pagination control for PDFs', () => {
		expect(pdfViewer).toContain('<DocumentPagination');
	});

	it('keeps page controls accessible and stable across boundaries', () => {
		expect(pagination).toContain('aria-live="polite"');
		expect(pagination).toContain('disabled={current <= 1 || pending}');
		expect(pagination).toContain('disabled={current >= total || pending}');
		expect(pagination).toContain('min-w-[4.5rem]');
		expect(pagination).toContain('tabular-nums');
	});

	it('keeps bounded 10 percent zoom controls across document viewers', () => {
		expect(pdfViewer).toContain('<DocumentZoomControls');
		expect(presentationViewer).toContain('DOCUMENT_ZOOM_BUTTON_STEP');
		expect(wordViewer).toContain('DOCUMENT_ZOOM_BUTTON_STEP');
		expect(zoomControls).toContain('disabled={percent <= minimum || pending}');
		expect(zoomControls).toContain('disabled={percent >= maximum || pending}');
	});

	it('uses the shared wheel zoom behavior for PDF, PowerPoint, and Word', () => {
		for (const viewer of [pdfViewer, presentationViewer, wordViewer]) {
			expect(viewer).toContain('getDocumentWheelZoomDelta');
		}
		expect(wordViewer).toContain('panDocumentViewport');
		expect(wordViewer).toContain('<DocumentZoomToolbar');
	});

	it('supports two-axis trackpad panning in PowerPoint and Word', () => {
		expect(presentationViewer).toContain('on:wheel|nonpassive={handleStageWheel}');
		expect(presentationViewer).toContain('getDocumentWheelZoomDelta(e.deltaY)');
		expect(presentationViewer).toContain('moveBy(-e.deltaX, -e.deltaY, false)');
		expect(wordViewer).toContain('panDocumentViewport(outerContainer, e.deltaX, e.deltaY)');
		expect(wordViewer).toContain('on:pointermove={dragDocument}');
	});
});
