import { describe, expect, it } from 'vitest';
import { fileIconName, fileIconTone } from './fileIcon';

describe('workspace file icons', () => {
	it.each([
		['report.docx', 'docx-logo', 'blue'],
		['/mnt/slides.PPTX', 'pptx-logo', 'orange'],
		['budget.xlsx', 'xlsx-logo', 'emerald'],
		['data.csv', 'csv-logo', 'emerald'],
		['data.TSV', 'csv-logo', 'emerald'],
		['document.pdf', 'pdf-logo', 'red']
	])('resolves the icon and light/dark tones for %s', (name, icon, color) => {
		expect(fileIconName(name)).toBe(icon);
		expect(fileIconTone(name)).toBe(`text-${color}-600 dark:text-${color}-400`);
	});

	it('keeps folders, extensionless names and unknown files neutral', () => {
		expect(fileIconName('reports.docx', 'directory')).toBe('folder');
		expect(fileIconTone('reports.docx', 'directory')).toBe('text-gray-500 dark:text-gray-400');
		for (const name of ['docx', '/mnt/docs.pdf/README', 'notes.md', 'unknown.bin']) {
			expect(fileIconTone(name)).toBe(fileIconTone('plain.txt'));
		}
	});
});
