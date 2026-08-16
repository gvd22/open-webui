import { describe, expect, it } from 'vitest';

import {
	findMatchingPages,
	getPageAnchor,
	getOwnedPreviousPdfToDestroy,
	getScrollTopForPageAnchor,
	scanPdfText
} from './pdfViewerHelpers';

describe('PDF viewer helpers', () => {
	const pages = [
		{ pageNumber: 1, top: 0, height: 800 },
		{ pageNumber: 2, top: 820, height: 1000 },
		{ pageNumber: 3, top: 1840, height: 600 }
	];

	it('keeps a semantic page and relative offset through layout changes', () => {
		const anchor = getPageAnchor(pages, 1070);
		expect(anchor).toEqual({ pageNumber: 2, offset: 0.25 });
		expect(
			getScrollTopForPageAnchor(
				[
					{ pageNumber: 1, top: 0, height: 400 },
					{ pageNumber: 2, top: 420, height: 500 },
					{ pageNumber: 3, top: 940, height: 300 }
				],
				anchor
			)
		).toBe(545);
	});

	it('clamps anchors at document boundaries', () => {
		expect(getPageAnchor(pages, -100)).toEqual({ pageNumber: 1, offset: 0 });
		expect(getPageAnchor(pages, 10_000)).toEqual({ pageNumber: 3, offset: 1 });
	});

	it('releases only the stale load owned previous PDF after a newer swap', () => {
		const original = { id: 'original' };
		const staleCandidate = { id: 'stale-candidate' };
		const winningCandidate = { id: 'winner' };

		expect(getOwnedPreviousPdfToDestroy(original, winningCandidate)).toBe(original);
		expect(getOwnedPreviousPdfToDestroy(original, staleCandidate)).toBe(original);
		expect(getOwnedPreviousPdfToDestroy(winningCandidate, winningCandidate)).toBeNull();
	});

	it('finds case-insensitive matches independent of rendered pages', () => {
		const index = new Map([
			[1, 'Executive summary'],
			[5, 'Risk register'],
			[9, 'SUMMARY OF FINDINGS']
		]);
		expect(findMatchingPages(index, 'summary')).toEqual([1, 9]);
		expect(findMatchingPages(index, '  risk ')).toEqual([5]);
		expect(findMatchingPages(index, '')).toEqual([]);
	});

	it('searches uncached overflow pages without growing the bounded cache', async () => {
		const cache = new Map([
			[1, 'needle in cached prefix'],
			[2, 'cached without match']
		]);
		const readPages: number[] = [];
		const result = await scanPdfText({
			pageCount: 5,
			query: 'needle',
			cachedPages: cache,
			readPage: async (pageNumber) => {
				readPages.push(pageNumber);
				return pageNumber === 5 ? 'needle beyond cache limit' : 'nothing';
			},
			isCurrent: () => true,
			yieldToBrowser: async () => {}
		});

		expect(result).toEqual({ matches: [1, 5], cancelled: false });
		expect(readPages).toEqual([3, 4, 5]);
		expect([...cache.keys()]).toEqual([1, 2]);
	});

	it('does not publish stale results after the active query changes', async () => {
		let current = true;
		const progress: number[][] = [];
		const result = await scanPdfText({
			pageCount: 4,
			query: 'needle',
			cachedPages: new Map(),
			readPage: async (pageNumber) => {
				if (pageNumber === 1) current = false;
				return 'needle';
			},
			isCurrent: () => current,
			yieldToBrowser: async () => {},
			onProgress: (matches) => progress.push(matches)
		});

		expect(result.cancelled).toBe(true);
		expect(progress).toEqual([]);
	});
});
