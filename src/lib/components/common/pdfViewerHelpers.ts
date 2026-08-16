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

export const findMatchingPages = (pages: Map<number, string>, query: string) => {
	const normalizedQuery = query.trim().toLocaleLowerCase();
	if (!normalizedQuery) return [];
	return [...pages]
		.filter(([, text]) => text.toLocaleLowerCase().includes(normalizedQuery))
		.map(([pageNumber]) => pageNumber)
		.sort((left, right) => left - right);
};

type PdfTextScanOptions = {
	pageCount: number;
	query: string;
	cachedPages: Map<number, string>;
	readPage: (pageNumber: number) => Promise<string>;
	isCurrent: () => boolean;
	yieldToBrowser: () => Promise<void>;
	onProgress?: (matches: number[]) => void;
	batchSize?: number;
};

export const scanPdfText = async ({
	pageCount,
	query,
	cachedPages,
	readPage,
	isCurrent,
	yieldToBrowser,
	onProgress,
	batchSize = 4
}: PdfTextScanOptions) => {
	const normalizedQuery = query.trim().toLocaleLowerCase();
	const matches = new Set(findMatchingPages(cachedPages, normalizedQuery));
	const publish = () => onProgress?.([...matches].sort((left, right) => left - right));
	if (!normalizedQuery || !isCurrent()) return { matches: [], cancelled: !isCurrent() };

	for (let pageNumber = 1; pageNumber <= pageCount; pageNumber++) {
		if (!isCurrent()) return { matches: [...matches], cancelled: true };
		const cachedText = cachedPages.get(pageNumber);
		const text = cachedText ?? (await readPage(pageNumber));
		if (!isCurrent()) return { matches: [...matches], cancelled: true };
		if (text.toLocaleLowerCase().includes(normalizedQuery)) matches.add(pageNumber);
		if (pageNumber % batchSize === 0 || pageNumber === pageCount) {
			publish();
			await yieldToBrowser();
			if (!isCurrent()) return { matches: [...matches], cancelled: true };
		}
	}

	return { matches: [...matches].sort((left, right) => left - right), cancelled: false };
};
