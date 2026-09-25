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

const getZipEntrySize = (entry: JSZip.JSZipObject) =>
	(entry as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize;

const validatePptxRelationships = (xml: string) => {
	if (/<!DOCTYPE/i.test(xml)) throw new Error('PPTX relationship XML must not contain a DOCTYPE');
	const document = new DOMParser().parseFromString(xml, 'application/xml');
	if (document.getElementsByTagNameNS('*', 'parsererror').length) {
		throw new Error('PPTX relationship XML is malformed');
	}

	for (const element of document.getElementsByTagName('*')) {
		if (element.localName.toLowerCase() !== 'relationship') continue;
		const attributes = new Map<string, string>();
		for (const attribute of element.attributes) {
			const name = attribute.localName.toLowerCase();
			if (name !== 'targetmode' && name !== 'type') continue;
			if (attributes.has(name)) throw new Error('PPTX relationship attributes are ambiguous');
			attributes.set(name, attribute.value.trim());
		}
		if (
			attributes.get('targetmode')?.toLowerCase() === 'external' &&
			!/\/hyperlink$/i.test(attributes.get('type') ?? '')
		) {
			throw new Error('PPTX external resource relationships are not allowed');
		}
	}
};

export const validatePptxArchive = async (candidateData: ArrayBuffer, limits = PPTX_ZIP_LIMITS) => {
	const zip = await JSZip.loadAsync(candidateData, { createFolders: false, checkCRC32: false });
	const entries = Object.values(zip.files).filter((entry) => !entry.dir);
	if (entries.length > limits.maxEntries) throw new Error('PPTX has too many archive entries');

	let totalBytes = 0;
	let mediaBytes = 0;
	const relationshipEntries: JSZip.JSZipObject[] = [];
	for (const entry of entries) {
		const size = getZipEntrySize(entry);
		if (typeof size !== 'number' || !Number.isSafeInteger(size) || size < 0) {
			throw new Error('PPTX entry size is invalid');
		}
		if (size > limits.maxEntryUncompressedBytes) {
			throw new Error('PPTX archive entry is too large');
		}
		totalBytes += size;
		if (entry.name.startsWith('ppt/media/')) mediaBytes += size;
		if (/^ppt\/(?:.*\/)?_rels\/[^/]+\.rels$/i.test(entry.name)) {
			relationshipEntries.push(entry);
		}
	}
	if (totalBytes > limits.maxTotalUncompressedBytes) {
		throw new Error('PPTX expands beyond the viewer limit');
	}
	if (mediaBytes > limits.maxMediaBytes) throw new Error('PPTX media exceeds the viewer limit');

	for (const entry of relationshipEntries) {
		const xml = await entry.async('text');
		validatePptxRelationships(xml);
	}
};

const validateBoundedOfficeArchive = async (
	candidateData: ArrayBuffer,
	limits = DOCX_ZIP_LIMITS,
	label = 'DOCX'
) => {
	const zip = await JSZip.loadAsync(candidateData, { createFolders: false, checkCRC32: false });
	const entries = Object.values(zip.files).filter((entry) => !entry.dir);
	if (entries.length > limits.maxEntries) throw new Error(`${label} has too many archive entries`);

	let totalBytes = 0;
	let mediaBytes = 0;
	for (const entry of entries) {
		const size = getZipEntrySize(entry);
		if (typeof size !== 'number' || !Number.isSafeInteger(size) || size < 0) {
			throw new Error(`${label} entry size is invalid`);
		}
		if (size > limits.maxEntryBytes) throw new Error(`${label} archive entry is too large`);
		totalBytes += size;
		if (entry.name.startsWith('word/media/')) mediaBytes += size;
	}
	if (totalBytes > limits.maxTotalBytes)
		throw new Error(`${label} expands beyond the viewer limit`);
	if (mediaBytes > limits.maxMediaBytes) throw new Error(`${label} media exceeds the viewer limit`);
	if (totalBytes > candidateData.byteLength * limits.maxCompressionRatio) {
		throw new Error(`${label} compression ratio exceeds the viewer limit`);
	}
};

export const validateDocxArchive = (candidateData: ArrayBuffer, limits = DOCX_ZIP_LIMITS) =>
	validateBoundedOfficeArchive(candidateData, limits, 'DOCX');

export const validateSpreadsheetArchive = (candidateData: ArrayBuffer) =>
	validateBoundedOfficeArchive(candidateData, DOCX_ZIP_LIMITS, 'Spreadsheet');
