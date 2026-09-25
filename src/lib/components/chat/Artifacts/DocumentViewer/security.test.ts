import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';

import {
	isSafeDocumentLink,
	validateDocxArchive,
	validateSpreadsheetArchive
} from '$lib/components/common/documentSecurity';

describe('document viewer security', () => {
	it('allows only inert fragments and expected external link protocols', () => {
		const base = 'https://open-webui.local/';
		expect(isSafeDocumentLink('#section', base)).toBe(true);
		expect(isSafeDocumentLink('https://example.com', base)).toBe(true);
		expect(isSafeDocumentLink('mailto:team@example.com', base)).toBe(true);
		expect(isSafeDocumentLink('javascript:alert(1)', base)).toBe(false);
		expect(isSafeDocumentLink('data:text/html,<script>alert(1)</script>', base)).toBe(false);
	});

	it('rejects DOCX archives that exceed the entry budget', async () => {
		const zip = new JSZip();
		zip.file('word/document.xml', '<document/>');
		zip.file('word/media/one.txt', 'one');
		const data = await zip.generateAsync({ type: 'arraybuffer' });

		await expect(
			validateDocxArchive(data, {
				maxEntries: 1,
				maxEntryBytes: 1024,
				maxTotalBytes: 2048,
				maxMediaBytes: 1024,
				maxCompressionRatio: 120
			})
		).rejects.toThrow('too many archive entries');
	});

	it('reads real JSZip entry sizes and accepts a bounded archive', async () => {
		const zip = new JSZip();
		zip.file('word/document.xml', '<document>bounded</document>');
		zip.file('word/media/image.bin', new Uint8Array(128));
		const data = await zip.generateAsync({ type: 'arraybuffer' });

		await expect(validateDocxArchive(data)).resolves.toBeUndefined();
	});

	it('rejects oversized entries, media totals, and highly compressed archives', async () => {
		const zip = new JSZip();
		zip.file('word/document.xml', 'a'.repeat(16_384));
		zip.file('word/media/image.bin', new Uint8Array(512));
		const data = await zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' });
		const common = {
			maxEntries: 10,
			maxEntryBytes: 32_768,
			maxTotalBytes: 64_000,
			maxMediaBytes: 1024,
			maxCompressionRatio: 120
		};

		await expect(validateDocxArchive(data, { ...common, maxEntryBytes: 1000 })).rejects.toThrow(
			'entry is too large'
		);
		await expect(validateDocxArchive(data, { ...common, maxMediaBytes: 100 })).rejects.toThrow(
			'media exceeds'
		);
		await expect(validateDocxArchive(data, { ...common, maxCompressionRatio: 2 })).rejects.toThrow(
			'compression ratio exceeds'
		);
	});

	it('rejects malformed ZIP input', async () => {
		await expect(
			validateDocxArchive(new TextEncoder().encode('not a zip').buffer)
		).rejects.toThrow();
	});

	it('applies bounded archive validation before rendering XLSX files', async () => {
		await expect(
			validateSpreadsheetArchive(new TextEncoder().encode('not a zip').buffer)
		).rejects.toThrow();
	});
});
