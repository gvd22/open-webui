import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const pagination = readFileSync(new URL('./DocumentPagination.svelte', import.meta.url), 'utf8');
const zoomControls = readFileSync(
	new URL('./DocumentZoomControls.svelte', import.meta.url),
	'utf8'
);
const pdfViewer = readFileSync(new URL('./PDFViewer.svelte', import.meta.url), 'utf8');
const presentationViewer = readFileSync(
	new URL('../chat/Artifacts/DocumentViewer/PowerPointDocumentViewer.svelte', import.meta.url),
	'utf8'
);
const wordViewer = readFileSync(
	new URL('../chat/Artifacts/DocumentViewer/WordDocumentViewer.svelte', import.meta.url),
	'utf8'
);

describe('document pagination', () => {
	it('uses one shared Open WebUI control in paginated document viewers', () => {
		expect(pdfViewer).toContain('<DocumentPagination');
		expect(presentationViewer).toContain('<DocumentPagination');
		expect(presentationViewer).not.toContain('slide-controls');
	});

	it('keeps page controls accessible and stable across boundaries', () => {
		expect(pagination).toContain('aria-live="polite"');
		expect(pagination).toContain('disabled={current <= 1 || pending}');
		expect(pagination).toContain('disabled={current >= total || pending}');
		expect(pagination).toContain('min-w-[4.5rem]');
		expect(pagination).toContain('tabular-nums');
	});

	it('shares bounded zoom controls between PDF and PowerPoint', () => {
		expect(pdfViewer).toContain('<DocumentZoomControls');
		expect(presentationViewer).toContain('<DocumentZoomControls');
		expect(presentationViewer).not.toContain("from 'panzoom'");
		expect(presentationViewer).toContain('viewerContainer.style.transform = `scale(${scale})`');
		expect(zoomControls).toContain('disabled={percent <= minimum || pending}');
		expect(zoomControls).toContain('disabled={percent >= maximum || pending}');
	});

	it('uses the shared document zoom behavior for PDF, PowerPoint, and Word', () => {
		for (const viewer of [pdfViewer, presentationViewer, wordViewer]) {
			expect(viewer).toContain('getDocumentWheelZoomDelta');
			expect(viewer).toContain('panDocumentViewport');
			expect(viewer).toContain('DOCUMENT_ZOOM_BUTTON_STEP');
			expect(viewer).toContain('DOCUMENT_ZOOM_MAX');
		}
		expect(wordViewer).toContain('<DocumentZoomToolbar');
	});

	it('uses native two-axis scrolling and fast pointer-anchored PowerPoint zoom', () => {
		expect(presentationViewer).toContain('overflow-auto');
		expect(presentationViewer).toContain('on:wheel|nonpassive={handleDocumentWheel}');
		expect(presentationViewer).toContain('getDocumentWheelZoomDelta(event.deltaY)');
		expect(presentationViewer).toContain('host.scrollLeft =');
		expect(presentationViewer).toContain('host.scrollTop =');
		expect(presentationViewer).toContain("'--presentation-scroll-size'");
		expect(presentationViewer).toContain('.presentation-container::before');
		expect(presentationViewer).toContain('position: absolute');
		expect(presentationViewer).toContain('on:pointermove={dragPresentation}');
	});
});
