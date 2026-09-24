/**
 * Shared Excel → HTML table renderer.
 *
 * Converts a worksheet to a styled HTML table with:
 * - Column letter headers (A, B, C…)
 * - Row numbers
 * - Proper empty cell handling
 * - Sanitized output
 */

import type { WorkSheet } from 'xlsx';

export const MAX_SPREADSHEET_PREVIEW_CELLS = 100_000;

/** Convert column index (0-based) to Excel-style letter (A, B, …, Z, AA, AB, …) */
const colLetter = (i: number): string => {
	let s = '';
	let n = i;
	while (n >= 0) {
		s = String.fromCharCode(65 + (n % 26)) + s;
		n = Math.floor(n / 26) - 1;
	}
	return s;
};

/** Escape HTML entities */
const esc = (v: unknown): string => {
	if (v === null || v === undefined || v === '') return '&nbsp;';
	return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
};

export interface ExcelTableResult {
	html: string;
	rowCount: number;
	colCount: number;
}

/**
 * Render a worksheet as an HTML table string.
 * Uses stored cell formats for display, without changing the source values.
 */
export async function excelToTable(worksheet: WorkSheet): Promise<ExcelTableResult> {
	const XLSX = await import('xlsx');
	const range = XLSX.utils.decode_range(worksheet['!ref'] ?? 'A1');
	const height = range.e.r - range.s.r + 1;
	const width = range.e.c - range.s.c + 1;
	// Sparse sheets can declare huge ranges even when their file is tiny.
	if (
		height < 1 ||
		width < 1 ||
		!Number.isSafeInteger(height * width) ||
		height * width > MAX_SPREADSHEET_PREVIEW_CELLS
	) {
		throw new Error('too-large');
	}
	const rows: unknown[][] = XLSX.utils.sheet_to_json(worksheet, {
		header: 1,
		defval: '',
		raw: false
	});
	const origin = range.s;

	if (rows.length === 0) {
		return {
			html: '<table><tbody><tr><td>&nbsp;</td></tr></tbody></table>',
			rowCount: 0,
			colCount: 0
		};
	}

	// Determine column count from the widest row
	const colCount = rows.reduce((max, row) => Math.max(max, row.length), 0);
	const rowCount = rows.length;

	const parts: string[] = [];
	parts.push('<table>');

	// Column letter header row
	parts.push('<thead><tr>');
	parts.push('<th class="excel-row-num"></th>'); // corner cell
	for (let c = 0; c < colCount; c++) {
		parts.push(`<th class="excel-col-hdr">${colLetter(c)}</th>`);
	}
	parts.push('</tr></thead>');

	// Data rows
	parts.push('<tbody>');
	for (let r = 0; r < rowCount; r++) {
		const row = rows[r];
		parts.push('<tr>');
		parts.push(`<td class="excel-row-num">${r + 1}</td>`);
		for (let c = 0; c < colCount; c++) {
			const val = c < row.length ? row[c] : '';
			const cell = worksheet[XLSX.utils.encode_cell({ r: origin.r + r, c: origin.c + c })];
			const isNum = cell?.t === 'n';
			parts.push(`<td${isNum ? ' class="excel-num"' : ''}>${esc(val)}</td>`);
		}
		parts.push('</tr>');
	}
	parts.push('</tbody></table>');

	const DOMPurify = (await import('dompurify')).default;
	return {
		html: DOMPurify.sanitize(parts.join('')),
		rowCount,
		colCount
	};
}
