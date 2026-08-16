export type PdfPageMetric = {
	pageNumber: number;
	top: number;
	height: number;
};

export type PdfPageAnchor = {
	pageNumber: number;
	offset: number;
};

const clamp = (value: number, minimum: number, maximum: number) =>
	Math.min(maximum, Math.max(minimum, value));

export const getPageAnchor = (pages: PdfPageMetric[], scrollTop: number): PdfPageAnchor | null => {
	if (!pages.length) return null;
	const page =
		pages.find(({ top, height }) => scrollTop < top + Math.max(height, 1)) ?? pages.at(-1)!;
	return {
		pageNumber: page.pageNumber,
		offset: clamp((scrollTop - page.top) / Math.max(page.height, 1), 0, 1)
	};
};

export const getScrollTopForPageAnchor = (pages: PdfPageMetric[], anchor: PdfPageAnchor | null) => {
	if (!anchor) return 0;
	const page = pages.find(({ pageNumber }) => pageNumber === anchor.pageNumber);
	return page ? page.top + page.height * clamp(anchor.offset, 0, 1) : 0;
};

export const getOwnedPreviousPdfToDestroy = <T>(previous: T | null, active: T | null) =>
	previous && previous !== active ? previous : null;
