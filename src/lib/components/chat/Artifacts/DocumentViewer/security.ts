import JSZip from 'jszip';

export const DOCX_ZIP_LIMITS = {
	maxEntries: 1500,
	maxEntryBytes: 16 * 1024 * 1024,
	maxTotalBytes: 96 * 1024 * 1024,
	maxMediaBytes: 64 * 1024 * 1024,
	maxCompressionRatio: 120
};

export const PPTX_ZIP_LIMITS = {
	maxEntries: 1500,
	maxEntryUncompressedBytes: 16 * 1024 * 1024,
	maxTotalUncompressedBytes: 96 * 1024 * 1024,
	maxMediaBytes: 64 * 1024 * 1024,
	maxConcurrency: 4
};

export const isSafeDocumentLink = (href: string, baseUrl: string) => {
	const trimmed = href.trim();
	if (trimmed.startsWith('#')) return true;
	try {
		return ['http:', 'https:', 'mailto:', 'tel:'].includes(new URL(trimmed, baseUrl).protocol);
	} catch {
		return false;
	}
};

export const hardenDocumentLinks = (root: HTMLElement) => {
	for (const anchor of root.querySelectorAll<HTMLAnchorElement>('a[href]')) {
		const href = anchor.getAttribute('href')?.trim() ?? '';
		if (!isSafeDocumentLink(href, window.location.href)) {
			anchor.removeAttribute('href');
		} else if (!href.startsWith('#')) {
			anchor.target = '_blank';
			anchor.rel = 'noopener noreferrer';
		}
	}
};

export const validateDocxArchive = async (candidateData: ArrayBuffer, limits = DOCX_ZIP_LIMITS) => {
	const zip = await JSZip.loadAsync(candidateData, { createFolders: false, checkCRC32: false });
	const entries = Object.values(zip.files).filter((entry) => !entry.dir);
	if (entries.length > limits.maxEntries) throw new Error('DOCX has too many archive entries');

	let totalBytes = 0;
	let mediaBytes = 0;
	for (const entry of entries) {
		const metadata = (entry as unknown as { _data?: { uncompressedSize?: number } })._data;
		const size = metadata?.uncompressedSize;
		if (!Number.isSafeInteger(size) || size < 0) throw new Error('DOCX entry size is invalid');
		if (size > limits.maxEntryBytes) throw new Error('DOCX archive entry is too large');
		totalBytes += size;
		if (entry.name.startsWith('word/media/')) mediaBytes += size;
	}
	if (totalBytes > limits.maxTotalBytes) throw new Error('DOCX expands beyond the viewer limit');
	if (mediaBytes > limits.maxMediaBytes) throw new Error('DOCX media exceeds the viewer limit');
	if (totalBytes > candidateData.byteLength * limits.maxCompressionRatio) {
		throw new Error('DOCX compression ratio exceeds the viewer limit');
	}
};
