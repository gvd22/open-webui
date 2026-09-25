import { describe, expect, it, vi } from 'vitest';
import {
	clampDocumentZoom,
	DOCUMENT_ZOOM_BUTTON_STEP,
	getDocumentWheelZoomDelta,
	panDocumentViewport
} from './documentZoom';

describe('document zoom behavior', () => {
	it('uses consistent bounds and button steps', () => {
		expect(clampDocumentZoom(10)).toBe(50);
		expect(clampDocumentZoom(350)).toBe(300);
		expect(DOCUMENT_ZOOM_BUTTON_STEP).toBe(10);
	});

	it('keeps trackpad zoom controlled but responsive', () => {
		expect(getDocumentWheelZoomDelta(-1)).toBe(2);
		expect(getDocumentWheelZoomDelta(1)).toBe(-2);
		expect(getDocumentWheelZoomDelta(-100)).toBe(12);
		expect(getDocumentWheelZoomDelta(100)).toBe(-12);
		expect(getDocumentWheelZoomDelta(0)).toBe(0);
	});

	it('pans a document viewport on both axes', () => {
		const scrollBy = vi.fn();
		panDocumentViewport({ scrollBy } as unknown as HTMLElement, 14, -9);
		expect(scrollBy).toHaveBeenCalledWith({ left: 14, top: -9, behavior: 'auto' });
	});
});
