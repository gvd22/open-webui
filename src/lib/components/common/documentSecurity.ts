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

const decodeXmlAttribute = (value: string) =>
	value.replace(/&(amp|quot|apos|lt|gt|#\d+|#x[\da-f]+);/gi, (entity, code: string) => {
		const named = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>' } as const;
		const normalized = code.toLowerCase();
		if (normalized in named) return named[normalized as keyof typeof named];
		const number = normalized.startsWith('#x')
			? Number.parseInt(normalized.slice(2), 16)
			: Number.parseInt(normalized.slice(1), 10);
		return Number.isSafeInteger(number) && number >= 0 && number <= 0x10ffff
			? String.fromCodePoint(number)
			: entity;
	});

const getXmlAttribute = (tag: string, name: string) => {
	const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i'));
	return decodeXmlAttribute(match?.[1] ?? match?.[2] ?? '').trim();
};

const isBlockedExternalRelationship = (tag: string) => {
	if (getXmlAttribute(tag, 'TargetMode').toLowerCase() !== 'external') return false;
	return !/\/hyperlink$/i.test(getXmlAttribute(tag, 'Type'));
};

const getRelationshipTags = (xml: string) => {
	const relationships: string[] = [];
	let cursor = 0;
	while (cursor < xml.length) {
		const start = xml.indexOf('<', cursor);
		if (start === -1) break;
		const delimiter = xml.startsWith('<!--', start)
			? '-->'
			: xml.startsWith('<![CDATA[', start)
				? ']]>'
				: xml.startsWith('<?', start)
					? '?>'
					: '';
		if (delimiter) {
			const delimitedEnd = xml.indexOf(delimiter, start + 2);
			if (delimitedEnd === -1) throw new Error('PPTX relationship XML is malformed');
			cursor = delimitedEnd + delimiter.length;
			continue;
		}

		let quote = '';
		let end = start + 1;
		for (; end < xml.length; end += 1) {
			const character = xml[end];
			if (quote) {
				if (character === quote) quote = '';
				continue;
			}
			if (character === '"' || character === "'") quote = character;
			else if (character === '>') break;
		}
		if (end === xml.length) throw new Error('PPTX relationship XML is malformed');

		const tag = xml.slice(start, end + 1);
		if (/^<\s*(?:[\w.-]+:)?Relationship\b/i.test(tag)) relationships.push(tag);
		cursor = end + 1;
	}
	return relationships;
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
		const relationships = getRelationshipTags(xml);
		if (relationships.some(isBlockedExternalRelationship)) {
			throw new Error('PPTX external resource relationships are not allowed');
		}
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
	if (totalBytes > limits.maxTotalBytes) throw new Error(`${label} expands beyond the viewer limit`);
	if (mediaBytes > limits.maxMediaBytes) throw new Error(`${label} media exceeds the viewer limit`);
	if (totalBytes > candidateData.byteLength * limits.maxCompressionRatio) {
		throw new Error(`${label} compression ratio exceeds the viewer limit`);
	}
};

export const validateDocxArchive = (candidateData: ArrayBuffer, limits = DOCX_ZIP_LIMITS) =>
	validateBoundedOfficeArchive(candidateData, limits, 'DOCX');

export const validateSpreadsheetArchive = (candidateData: ArrayBuffer) =>
	validateBoundedOfficeArchive(candidateData, DOCX_ZIP_LIMITS, 'Spreadsheet');
