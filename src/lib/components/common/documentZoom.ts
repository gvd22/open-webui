export const DOCUMENT_ZOOM_MIN = 50;
export const DOCUMENT_ZOOM_MAX = 300;
export const DOCUMENT_ZOOM_BUTTON_STEP = 10;

export const clampDocumentZoom = (value: number) =>
	Math.max(DOCUMENT_ZOOM_MIN, Math.min(DOCUMENT_ZOOM_MAX, Math.round(value)));

export const getDocumentWheelZoomDelta = (deltaY: number) => {
	const direction = Math.sign(-deltaY);
	if (direction === 0) return 0;
	return direction * Math.min(12, Math.max(2, Math.abs(deltaY) * 0.5));
};

export const panDocumentViewport = (viewport: HTMLElement, deltaX: number, deltaY: number) => {
	viewport.scrollBy({ left: deltaX, top: deltaY, behavior: 'auto' });
};
