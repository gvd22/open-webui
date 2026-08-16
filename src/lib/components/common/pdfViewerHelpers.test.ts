import { describe, expect, it } from 'vitest';

import {
	getPageAnchor,
	getOwnedPreviousPdfToDestroy,
	getScrollTopForPageAnchor
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
});
