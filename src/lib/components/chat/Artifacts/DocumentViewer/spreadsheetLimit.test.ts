import { afterEach, describe, expect, it, vi } from 'vitest';
import * as XLSX from 'xlsx';
import { excelToTable, MAX_SPREADSHEET_PREVIEW_CELLS } from '$lib/utils/excelToTable';

vi.mock('dompurify', () => ({ default: { sanitize: (html: string) => html } }));

afterEach(() => {
	vi.restoreAllMocks();
});

describe('spreadsheet preview cell budget', () => {
	for (const range of ['A1:XFD1048576', 'A1:A100001', 'A1:CV1001', 'B2:A1']) {
		it(`rejects ${range} before materializing rows`, async () => {
			const convert = vi.spyOn(XLSX.utils, 'sheet_to_json').mockReturnValue([]);
			await expect(excelToTable({ '!ref': range })).rejects.toThrow('too-large');
			expect(convert).not.toHaveBeenCalled();
		});
	}

	it('accepts the exact budget at a nonzero origin without changing the source', async () => {
		const convert = vi.spyOn(XLSX.utils, 'sheet_to_json').mockReturnValue([['42']]);
		const sheet: XLSX.WorkSheet = {
			'!ref': XLSX.utils.encode_range({
				s: { r: 4, c: 2 },
				e: { r: 4 + MAX_SPREADSHEET_PREVIEW_CELLS / 100 - 1, c: 101 }
			}),
			C5: { t: 'n', v: 42 }
		};
		const original = structuredClone(sheet);
		await expect(excelToTable(sheet)).resolves.toMatchObject({ rowCount: 1, colCount: 1 });
		expect(convert).toHaveBeenCalledOnce();
		expect(sheet).toEqual(original);
	});

	it('still accepts an empty worksheet', async () => {
		await expect(excelToTable({})).resolves.toMatchObject({ rowCount: 0, colCount: 0 });
	});
});
