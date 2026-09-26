import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import * as XLSX from 'xlsx';
import JSZip from 'jszip';

const paths = {
	pdf: '/mnt/uploads/basic.pdf',
	docx: '/mnt/uploads/basic.docx',
	pptx: '/mnt/uploads/basic.pptx',
	csv: '/mnt/uploads/basic.csv'
};

let blockedRequests: string[] = [];

const sparseWorkbook = async (withSmallSheets = false) => {
	const workbook = XLSX.utils.book_new();
	if (withSmallSheets) {
		XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['Small sheet']]), 'Small');
	}
	XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['Sparse sheet']]), 'Huge');
	if (withSmallSheets) {
		XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['Other sheet']]), 'Other');
	}
	const zip = await JSZip.loadAsync(XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }));
	const path = `xl/worksheets/sheet${withSmallSheets ? 2 : 1}.xml`;
	zip.file(
		path,
		(await zip.file(path)!.async('string')).replace(
			/<dimension[^>]*\/>/,
			'<dimension ref="A1:XFD1048576"/>'
		)
	);
	return zip.generateAsync({ type: 'nodebuffer' });
};

for (const source of ['workspace', 'saved'] as const) {
	for (const format of ['xlsx', 'xls', 'csv'] as const) {
		test(`enforces the cell budget for ${source} ${format} and downloads the intact original`, async ({
			page
		}) => {
			let bytes: Buffer;
			if (format === 'xlsx') bytes = await sparseWorkbook();
			else if (format === 'csv') bytes = Buffer.from(('1,'.repeat(29) + '1\n').repeat(3340));
			else {
				const workbook = XLSX.utils.book_new();
				const sheet = XLSX.utils.aoa_to_sheet([['Sparse sheet']]);
				sheet.IV501 = { t: 'n', v: 1 };
				sheet['!ref'] = 'A1:IV501';
				XLSX.utils.book_append_sheet(workbook, sheet, 'Huge');
				bytes = XLSX.write(workbook, { type: 'buffer', bookType: 'biff8' });
			}
			expect(bytes.length).toBeLessThan(1024 * 1024);
			const errors: string[] = [];
			page.on('pageerror', (error) => errors.push(error.message));
			const savedFileId = `cell-budget-${randomUUID()}.${format}`;
			if (source === 'saved') {
				const seeded = await page.request.post(`/api/v1/files/${savedFileId}/content`, {
					data: bytes
				});
				expect(seeded.status()).toBe(204);
			} else {
				await page.route('**/runtime/files/view?**', (route) => route.fulfill({ body: bytes }));
			}
			await page.setViewportSize({ width: source === 'saved' ? 390 : 1200, height: 844 });
			await page.goto(
				`/?format=${format}&theme=dark${source === 'saved' ? `&fileId=${savedFileId}` : ''}`
			);
			await expect(page.getByText('This document is too large to display here.')).toBeVisible();
			await expect(page.getByRole('button', { name: 'Try again', exact: true })).toHaveCount(0);
			await expect(page.locator('.office-sheet')).toHaveCount(0);
			const downloaded = page.waitForEvent('download');
			await page.getByRole('button', { name: 'Download', exact: true }).click();
			expect(
				createHash('sha256')
					.update(await readFile(await (await downloaded).path()))
					.digest('hex')
			).toBe(createHash('sha256').update(bytes).digest('hex'));
			expect(errors).toEqual([]);
			await page.screenshot({
				path: test.info().outputPath(`cell-budget-${source}-${format}.png`)
			});
		});
	}
}

test('renders a 90000-cell CSV below the cell budget without truncating it', async ({ page }) => {
	const csv = Array.from({ length: 3000 }, (_, row) =>
		Array.from({ length: 30 }, (_, column) => `${row}-${column}`).join(',')
	).join('\n');
	await page.route('**/runtime/files/view?**', (route) => route.fulfill({ body: csv }));
	await page.goto('/?format=csv');
	const sheet = page.locator('.office-sheet');
	await expect(sheet.locator('tbody tr')).toHaveCount(3000);
	await expect(sheet.locator('tbody tr').last().locator('td').last()).toHaveText('2999-29');
	await expect(page.getByText('This document is too large to display here.')).toHaveCount(0);
	const downloaded = page.waitForEvent('download');
	await page.getByLabel('Download displayed version').click();
	expect((await readFile(await (await downloaded).path())).toString('utf8')).toBe(csv);
});

test('keeps sheet navigation usable after a cell budget rejection', async ({ page }) => {
	const bytes = await sparseWorkbook(true);
	const errors: string[] = [];
	page.on('pageerror', (error) => errors.push(error.message));
	await page.route('**/runtime/files/view?**', (route) => route.fulfill({ body: bytes }));
	await page.goto('/?format=xlsx');
	await expect(page.getByRole('cell', { name: 'Small sheet', exact: true })).toBeVisible();
	await page.getByRole('button', { name: 'Huge', exact: true }).click();
	await expect(page.getByText('This document is too large to display here.')).toBeVisible();
	await expect(page.getByRole('cell', { name: 'Small sheet', exact: true })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Download', exact: true })).toBeVisible();
	await page.getByRole('button', { name: 'Other', exact: true }).click();
	await expect(page.getByRole('cell', { name: 'Other sheet', exact: true })).toBeVisible();
	await expect(page.getByText('This document is too large to display here.')).toHaveCount(0);
	await page.getByRole('button', { name: 'Huge', exact: true }).click();
	await expect(page.getByRole('button', { name: 'Download', exact: true })).toBeVisible();
	await page.getByRole('button', { name: 'Small', exact: true }).click();
	await expect(page.getByRole('cell', { name: 'Small sheet', exact: true })).toBeVisible();
	expect(errors).toEqual([]);
});

test('keeps the displayed snapshot when a refreshed sheet exceeds the cell budget', async ({
	page
}) => {
	const original = Buffer.from('city,value\nBasel,1\n');
	let bytes = original;
	await page.route('**/runtime/files/view?**', (route) => route.fulfill({ body: bytes }));
	await page.goto('/?format=csv');
	await expect(page.getByRole('cell', { name: 'Basel', exact: true })).toBeVisible();
	bytes = Buffer.from(('1,'.repeat(29) + '1\n').repeat(3340));
	await page.getByTestId('refresh-viewer').click();
	await expect(page.getByRole('button', { name: 'Download', exact: true })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Try again', exact: true })).toHaveCount(0);
	for (const [label, expected] of [
		['Download displayed version', original],
		['Download', bytes]
	] as const) {
		const downloaded = page.waitForEvent('download');
		await page.getByRole('button', { name: label, exact: true }).click();
		expect(await readFile(await (await downloaded).path())).toEqual(expected);
		await expect(page.getByRole('cell', { name: 'Basel', exact: true })).toBeVisible();
	}
});

for (const format of ['xlsx', 'xls'] as const) {
	test(`renders and switches ${format} sheets without changing the downloaded workbook`, async ({
		page
	}) => {
		const workbook = XLSX.utils.book_new();
		XLSX.utils.book_append_sheet(
			workbook,
			XLSX.utils.aoa_to_sheet([
				['City', 'Value'],
				['Z\u00fcrich', 42],
				['<img src=x onerror=alert(1)>', 7]
			]),
			'Data'
		);
		XLSX.utils.book_append_sheet(
			workbook,
			XLSX.utils.aoa_to_sheet([['Notes'], ['Second sheet content']]),
			'Notes'
		);
		XLSX.utils.sheet_add_aoa(workbook.Sheets.Data, [[46288, 1234.5, 0.125]], { origin: 'A4' });
		workbook.Sheets.Data.A4.z = 'yyyy-mm-dd';
		workbook.Sheets.Data.B4.z = '#,##0.00';
		workbook.Sheets.Data.C4.z = '0.0%';
		const bytes = XLSX.write(workbook, {
			type: 'buffer',
			bookType: format === 'xls' ? 'biff8' : 'xlsx'
		});
		await page.route('**/runtime/files/view?**', (route) => route.fulfill({ body: bytes }));
		for (const theme of ['light', 'dark']) {
			await page.setViewportSize({ width: theme === 'dark' ? 390 : 1200, height: 844 });
			await page.goto(`/?format=${format}&theme=${theme}`);
			const sheet = page.locator('.office-sheet');
			await expect(sheet).toContainText('Z\u00fcrich');
			await expect(sheet).toContainText('<img src=x onerror=alert(1)>');
			await expect(sheet.locator('img')).toHaveCount(0);
			await expect(sheet.getByRole('cell', { name: '2026-09-23', exact: true })).toBeVisible();
			await expect(sheet.getByRole('cell', { name: '1,234.50', exact: true })).toHaveClass(
				'excel-num'
			);
			await expect(sheet.getByRole('cell', { name: '12.5%', exact: true })).toBeVisible();
			await page.getByRole('button', { name: 'Notes', exact: true }).click();
			await expect(sheet).toContainText('Second sheet content');
			await expect(sheet).not.toContainText('Z\u00fcrich');
			await page.getByRole('button', { name: 'Data', exact: true }).click();
			await expect(sheet).toContainText('Z\u00fcrich');
			const downloadPromise = page.waitForEvent('download');
			await page.getByLabel('Download displayed version').click();
			const downloaded = await downloadPromise;
			expect(
				createHash('sha256')
					.update(await readFile(await downloaded.path()))
					.digest('hex')
			).toBe(createHash('sha256').update(bytes).digest('hex'));
			await page.screenshot({ path: test.info().outputPath(`${format}-${theme}.png`) });
		}
	});
}

test('preserves CSV dates, leading zeros, decimals, Unicode, and quoted multiline fields', async ({
	page
}) => {
	const csv =
		'\ufeffdate,id,value,label,note\n2026-09-23,00123,1.20,Z\u00fcrich,"first line\nsecond, line"\n';
	await page.route('**/runtime/files/view?**', (route) => route.fulfill({ body: csv }));
	await page.goto('/?format=csv');
	for (const value of ['2026-09-23', '00123', '1.20', 'Z\u00fcrich', 'first line second, line']) {
		await expect(page.getByRole('cell', { name: value, exact: true })).toBeVisible();
	}
	const downloaded = page.waitForEvent('download');
	await page.getByLabel('Download displayed version').click();
	expect((await readFile(await (await downloaded).path())).toString('utf8')).toBe(csv);
});

test('pins spreadsheet headers and corner to both scroll edges', async ({ page, browserName }) => {
	const csv = Array.from({ length: 100 }, (_, row) =>
		Array.from({ length: 16 }, (_, col) => `Cell ${row}-${col}`).join(',')
	).join('\n');
	await page.route('**/runtime/files/view?**', (route) =>
		route.fulfill({
			contentType: 'application/octet-stream',
			body: csv
		})
	);
	for (const width of [1200, 390]) {
		await page.setViewportSize({ width, height: 844 });
		for (const theme of ['light', 'dark']) {
			await page.goto(`/?format=csv&theme=${theme}`);
			const sheet = page.locator('.office-sheet');
			await expect(sheet.locator('tbody tr')).toHaveCount(100);
			expect(
				await sheet.evaluate((element) => ({
					horizontalOverflow: element.scrollWidth > element.clientWidth,
					verticalOverflow: element.scrollHeight > element.clientHeight,
					cornerBackground: getComputedStyle(element, '::-webkit-scrollbar-corner').backgroundColor
				}))
			).toEqual({
				horizontalOverflow: true,
				verticalOverflow: true,
				cornerBackground: browserName === 'firefox' ? '' : 'rgba(0, 0, 0, 0)'
			});
			await sheet.evaluate((element) => {
				element.scrollLeft = 175;
				element.scrollTop = 137;
			});
			await expect
				.poll(() =>
					sheet.evaluate((element) => {
						const rect = element.getBoundingClientRect();
						const corner = element.querySelector('thead .excel-row-num')!;
						const header = element.querySelector('th.excel-col-hdr')!;
						const row = element.querySelectorAll('tbody .excel-row-num')[10];
						return {
							left: corner.getBoundingClientRect().left - rect.left,
							top: corner.getBoundingClientRect().top - rect.top,
							rowLeft: row.getBoundingClientRect().left - rect.left,
							headerTop: header.getBoundingClientRect().top - rect.top,
							cornerOnTop: document.elementFromPoint(rect.left + 4, rect.top + 4) === corner,
							headerOnTop: document
								.elementFromPoint(rect.left + 100, rect.top + 4)
								?.classList.contains('excel-col-hdr')
						};
					})
				)
				.toEqual({
					left: 0,
					top: 0,
					rowLeft: 0,
					headerTop: 0,
					cornerOnTop: true,
					headerOnTop: true
				});
			await page.screenshot({ path: `.tmp/sheet-scroll-${width}-${theme}.png` });
		}
	}
});

test('keeps floating document actions inset and keyboard accessible', async ({
	page,
	browserName
}) => {
	for (const width of [1200, 390]) {
		await page.setViewportSize({ width, height: 844 });
		for (const format of ['pptx', 'pdf', 'docx', 'csv']) {
			await page.goto(`/?format=${format}&theme=dark`);
			const actions = page.getByRole('group', { name: 'Document actions' });
			await expect(actions).toBeVisible();
			const root = await page.getByTestId('document-file-viewer').boundingBox();
			const box = await actions.boundingBox();
			expect(box!.y - root!.y).toBe(12);
			expect(root!.x + root!.width - box!.x - box!.width).toBe(12);
			expect(box!.width).toBeLessThan(100);
			const content = await page.getByTestId('document-viewer-content').boundingBox();
			expect(content!.y).toBe(root!.y);
			expect(
				await page
					.getByTestId('document-viewer-content')
					.evaluate((element) => getComputedStyle(element).paddingTop)
			).toBe('0px');
			await page.getByLabel('Download displayed version').focus();
			// macOS WebKit uses Option+Tab to include non-input controls.
			await page.keyboard.press(
				browserName === 'webkit' && process.platform === 'darwin' ? 'Alt+Tab' : 'Tab'
			);
			await expect(page.getByRole('button', { name: 'Fullscreen', exact: true })).toBeFocused();
			if (format === 'pptx') {
				await page.getByRole('button', { name: 'Fullscreen', exact: true }).click();
				await expect
					.poll(() => page.evaluate(() => Boolean(document.fullscreenElement)))
					.toBe(true);
				await page.evaluate(() => document.exitFullscreen());
				await page.screenshot({ path: `.tmp/floating-viewer-${width}.png` });
			}
		}
	}
});

const getRuntimeSessionId = (page: Page) =>
	`viewer-browser-test-${page.context().browser()?.browserType().name() ?? 'unknown'}`;

test.beforeEach(async ({ page, baseURL }) => {
	blockedRequests = [];
	const runtimeSessionId = getRuntimeSessionId(page);
	await page.addInitScript((sessionId) => {
		localStorage.setItem('viewer-runtime-session', sessionId);
	}, runtimeSessionId);
	await page.route('**/*', async (route) => {
		const url = route.request().url();
		if (
			new URL(url).origin === new URL(baseURL!).origin ||
			url.startsWith('blob:') ||
			url.startsWith('data:')
		) {
			return route.continue();
		}
		blockedRequests.push(url);
		await route.abort();
	});
	await page.routeWebSocket('**/*', (ws) => {
		if (new URL(ws.url()).host === new URL(baseURL!).host) return;
		blockedRequests.push(ws.url());
		ws.close();
	});
	await Promise.all(
		Object.values(paths).map((path) => setRuntime(page, path, 'valid', runtimeSessionId, true))
	);
});

test.afterEach(() => expect(blockedRequests).toEqual([]));

const setRuntime = (
	page: Page,
	path: string,
	state: Record<string, unknown> | string,
	runtimeSessionId = getRuntimeSessionId(page),
	resetRequestCount = false
) =>
	page.request.post('/__viewer-runtime', {
		data:
			typeof state === 'string'
				? { path, mode: state, sessionId: runtimeSessionId, resetRequestCount }
				: { path, ...state, sessionId: runtimeSessionId, resetRequestCount }
	});

const viewerResponse = (page: Page, path: string, requestCount: number) =>
	page.waitForResponse(
		(response) =>
			new URL(response.url()).pathname === '/runtime/files/view' &&
			new URL(response.url()).searchParams.get('path') === path &&
			response.headers()['x-viewer-test-request-count'] === String(requestCount)
	);

test('renders the real PDF viewer fixture', async ({ page }) => {
	const unauthorized = await page.request.get(`/runtime/files/view?path=${paths.pdf}`);
	expect(unauthorized.status()).toBe(401);
	await page.goto('/?format=pdf');
	await expect(page.getByTestId('document-file-viewer')).toBeVisible();
	await expect(page.getByText('KOBY-BASIC-PDF-2-PAGES')).toBeVisible();
	const resetZoom = page.getByLabel('Reset zoom');
	await expect(resetZoom).toHaveText('100%');
	await page.getByLabel('Zoom in').click();
	await expect(resetZoom).not.toHaveText('100%');
	await page.getByLabel('Zoom out').click();
	await expect(resetZoom).toHaveText('100%');
	await page.getByLabel('Zoom in').click();
	await page.getByLabel('Reset zoom').click();
	await expect(resetZoom).toHaveText('100%');
	await expect(page.getByLabel('Next page')).toBeVisible();
	await expect(page.getByLabel('Search this PDF')).toHaveCount(0);
	await expect(
		new AxeBuilder({ page }).include('[data-testid="document-file-viewer"]').analyze()
	).resolves.toMatchObject({ violations: [] });
});

test('renders the real DOCX and PPTX fixtures with safe controls', async ({ page }) => {
	await page.goto('/?format=docx');
	await expect(page.getByText('KOBY-BASIC-DOCX-2-PAGES')).toBeVisible();
	for (const link of await page.locator('[data-testid="document-file-viewer"] a').all()) {
		await expect(link).toHaveAttribute('rel', /noopener/);
	}
	await page.goto('/?format=pptx');
	const firstSlide = page.getByRole('img', { name: 'Slide 1', exact: true });
	await expect(firstSlide).toBeVisible();
	expect((await firstSlide.boundingBox())?.width).toBeGreaterThan(20);
	const initialPlacement = await page
		.getByRole('application', { name: 'Slide preview' })
		.evaluate((viewport) => {
			const surface = viewport.querySelector<HTMLElement>('section img[alt="Slide 1"]');
			if (!surface) return null;
			const viewportRect = viewport.getBoundingClientRect();
			const surfaceRect = surface.getBoundingClientRect();
			return {
				insideX: surfaceRect.left >= viewportRect.left && surfaceRect.right <= viewportRect.right,
				insideY: surfaceRect.top >= viewportRect.top && surfaceRect.bottom <= viewportRect.bottom
			};
		});
	expect(initialPlacement).toEqual({ insideX: true, insideY: true });
	await page.getByRole('application', { name: 'Slide preview' }).focus();
	await page.keyboard.press('ArrowRight');
	await expect(page.getByText('2 / 2')).toBeVisible();
	const secondSlide = page.getByRole('img', { name: 'Slide 2', exact: true });
	await expect(secondSlide).toBeVisible();
	expect((await secondSlide.boundingBox())?.width).toBeGreaterThan(20);
});

test('renders CSV data in the shared spreadsheet viewer', async ({ page }) => {
	for (const theme of ['light', 'dark']) {
		for (const width of [1200, 390]) {
			await page.setViewportSize({ width, height: 844 });
			await page.goto(`/?format=csv&theme=${theme}`);
			const viewer = page.getByTestId('document-file-viewer');
			await expect(page.getByRole('cell', { name: 'Basel', exact: true })).toBeVisible();
			await expect(page.getByRole('cell', { name: 'Bern', exact: true })).toBeVisible();
			// Other app previews must not leak their global table styles into this viewer.
			await page.addStyleTag({
				content: '.office-preview table { font-family: monospace; min-width: 100%; }'
			});
			const layout = await viewer.evaluate((root) => {
				const table = root.querySelector('table')!;
				const background = getComputedStyle(root).backgroundColor;
				return {
					width: table.getBoundingClientRect().width,
					fontMatches: getComputedStyle(table).fontFamily === getComputedStyle(root).fontFamily,
					background,
					overflow: root.scrollWidth > root.clientWidth
				};
			});
			expect(layout.width).toBeLessThan(600);
			expect(layout.fontMatches).toBe(true);
			expect(layout.overflow).toBe(false);
			const themeBackground = await page.evaluate((dark) => {
				const sample = document.createElement('div');
				sample.style.backgroundColor = dark ? 'var(--color-gray-850)' : 'white';
				document.body.appendChild(sample);
				const color = getComputedStyle(sample).backgroundColor;
				sample.remove();
				return color;
			}, theme === 'dark');
			expect(layout.background).toBe(themeBackground);
		}
	}
});

test('opens requested workspace document pages without changing default zoom', async ({ page }) => {
	await page.goto('/?format=pdf&targetPage=2');
	await expect(page.getByText('2 / 2')).toBeVisible();
	await expect(page.getByLabel('Reset zoom')).toHaveText('100%');

	await page.goto('/?format=docx&targetPage=2');
	await expect(page.getByText('KOBY-BASIC-DOCX-2-PAGES')).toBeVisible();
	await expect(page.getByRole('region', { name: 'Word document' })).toBeVisible();
	await expect(page.getByLabel('Reset zoom')).toHaveText('100%');

	await page.goto('/?format=pptx&targetPage=2');
	await expect(page.getByRole('img', { name: 'Slide 2', exact: true })).toBeVisible();
	await expect(page.getByText('2 / 2')).toBeVisible();
	await expect(page.getByLabel('Reset zoom')).toHaveText('100%');
});

test('zooms, pans, resets, and reopens every document viewer', async ({ page }) => {
	const viewers = {
		pdf: {
			ready: () => page.getByText('KOBY-BASIC-PDF-2-PAGES'),
			content: () => page.locator('.pdf-page-wrapper').first(),
			viewport: () => page.getByRole('region', { name: /PDF document/ })
		},
		docx: {
			ready: () => page.getByText('KOBY-BASIC-DOCX-2-PAGES'),
			content: () => page.getByText('KOBY-BASIC-DOCX-2-PAGES'),
			viewport: () => page.getByRole('region', { name: 'Word document' })
		},
		pptx: {
			ready: () => page.getByRole('img', { name: 'Slide 1', exact: true }),
			content: () => page.getByRole('img', { name: 'Slide 1', exact: true }),
			viewport: () => page.getByRole('application', { name: 'Slide preview' }).locator('section')
		}
	} as const;

	for (const [format, viewer] of Object.entries(viewers)) {
		await page.goto(`/?format=${format}`);
		await expect(viewer.ready()).toBeVisible();

		const resetZoom = page.getByLabel('Reset zoom');
		await page.getByLabel('Zoom in').click();
		await expect(resetZoom).toHaveText('110%');

		await viewer.viewport().hover();
		await page.keyboard.down('Meta');
		await page.mouse.wheel(0, -100);
		await page.keyboard.up('Meta');
		await expect(resetZoom).toHaveText('122%');

		for (let index = 0; index < 8; index += 1) await page.getByLabel('Zoom in').click();
		await expect(resetZoom).toHaveText('202%');
		const beforePan = await viewer.content().boundingBox();
		expect(beforePan).not.toBeNull();
		await viewer.viewport().hover();
		await page.mouse.wheel(240, 240);
		// Viewers can pan using native scrolling or a CSS transform.
		await expect
			.poll(async () => {
				const afterPan = await viewer.content().boundingBox();
				return Boolean(
					beforePan && afterPan && (afterPan.x < beforePan.x - 1 || afterPan.y < beforePan.y - 1)
				);
			})
			.toBe(true);

		await resetZoom.click();
		await expect(resetZoom).toHaveText('100%');

		await page.goto(`/?format=${format}`);
		await expect(viewer.ready()).toBeVisible();
		await expect(page.getByLabel('Reset zoom')).toHaveText('100%');
		await expect
			.poll(() =>
				viewer.viewport().evaluate((element) => ({
					left: element.scrollLeft,
					top: element.scrollTop
				}))
			)
			.toEqual({ left: 0, top: 0 });
	}
});

test('keeps the last valid DOCX and its download when an update is corrupt', async ({ page }) => {
	await page.goto('/?format=docx');
	await expect(page.getByText('KOBY-BASIC-DOCX-2-PAGES')).toBeVisible();
	await setRuntime(page, paths.docx, 'corrupt');
	const corruptResponse = page.waitForResponse(
		(response) =>
			new URL(response.url()).pathname === '/runtime/files/view' &&
			new URL(response.url()).searchParams.get('path') === paths.docx
	);
	await page.getByTestId('refresh-viewer').click();
	await corruptResponse;
	await expect(page.getByRole('status')).toContainText('The latest update could not be displayed.');
	const downloadPromise = page.waitForEvent('download');
	await page.getByLabel('Download displayed version').click();
	const download = await downloadPromise;
	const downloaded = await readFile(await download.path());
	expect(createHash('sha256').update(downloaded).digest('hex')).toBe(
		'7f18f33dc6768681a70cbc1e101335136bbb9580f8ac97e745e0f8624ca489a9'
	);
});

test('clears a missing document and refreshes after an unavailable runtime reconnects', async ({
	page
}) => {
	await page.goto('/?format=pdf');
	await expect(page.getByText('KOBY-BASIC-PDF-2-PAGES')).toBeVisible();
	const viewer = page.getByTestId('document-file-viewer');
	await expect(viewer).toHaveAttribute('data-rendered-generation', '1');
	await setRuntime(page, paths.pdf, 'unavailable');
	const unavailableResponse = viewerResponse(page, paths.pdf, 2);
	await page.getByTestId('refresh-viewer').click();
	await unavailableResponse;
	await expect(
		page.getByText('The latest version could not be loaded. Showing the previous version.')
	).toBeVisible();
	await setRuntime(page, paths.pdf, 'valid');
	const reconnectedResponse = viewerResponse(page, paths.pdf, 3);
	await page.getByTestId('refresh-viewer').click();
	await reconnectedResponse;
	await expect(viewer).toHaveAttribute('data-rendered-generation', '3');
	await expect(page.getByText('KOBY-BASIC-PDF-2-PAGES')).toBeVisible();
	await page.getByTestId('delete-viewer').click();
	await expect(page.getByText('This file is no longer available.')).toBeVisible();
});

test('workspace document panels have one active owner and restore tab focus on close', async ({
	page
}) => {
	await page.goto('/?workspace-panels=1');

	const tabs = page.getByRole('tab');
	const panels = page.locator('[role="tabpanel"]');
	await expect(tabs).toHaveCount(2);
	await expect(tabs.nth(0).locator('[data-workspace-icon="pdf-logo"]')).toBeVisible();
	await expect(tabs.nth(1).locator('[data-workspace-icon="docx-logo"]')).toBeVisible();
	await expect(panels).toHaveCount(2);
	await expect(page.getByTestId('document-file-viewer')).toHaveCount(1);
	await expect(page.getByTestId('document-file-viewer')).toContainText('KOBY-BASIC-PDF-2-PAGES');

	const firstPanel = page.locator('#workspace-panel-0');
	const secondPanel = page.locator('#workspace-panel-1');
	await expect(firstPanel).not.toHaveAttribute('hidden', '');
	await expect(secondPanel).toHaveAttribute('hidden', '');
	expect(await secondPanel.locator('a, button, input, select, textarea, [tabindex]').count()).toBe(
		0
	);

	await tabs.nth(0).focus();
	await page.keyboard.press('ArrowRight');
	await expect(tabs.nth(1)).toBeFocused();
	await expect(firstPanel).toHaveAttribute('hidden', '');
	await expect(secondPanel).not.toHaveAttribute('hidden', '');
	await expect(page.getByTestId('document-file-viewer')).toHaveCount(1);
	await expect(page.locator('[data-document-path="/workspace/basic.pdf"]')).toHaveCount(0);
	await expect(page.getByTestId('document-file-viewer')).toContainText('KOBY-BASIC-DOCX-2-PAGES');

	await tabs.nth(0).click();
	await expect(page.locator('[data-document-path="/workspace/basic.docx"]')).toHaveCount(0);
	await expect(page.getByTestId('document-file-viewer')).toContainText('KOBY-BASIC-PDF-2-PAGES');
	await page.getByLabel('Zoom in').click();
	await page.getByLabel('Zoom in').click();
	await expect(page.getByLabel('Reset zoom')).toHaveText('120%');
	const pdfViewport = page.getByRole('region', { name: /PDF document/ });
	await pdfViewport.hover();
	await page.mouse.wheel(180, 240);
	await expect
		.poll(() => pdfViewport.evaluate((element) => element.scrollTop + element.scrollLeft))
		.toBeGreaterThan(0);
	await page.getByRole('button', { name: /Close: basic\.pdf/ }).click();
	await expect(tabs).toHaveCount(1);
	await expect(tabs.nth(0)).toBeFocused();
	await expect(page.getByTestId('document-file-viewer')).toContainText('KOBY-BASIC-DOCX-2-PAGES');

	await page.getByTestId('reopen-pdf').click();
	await expect(tabs).toHaveCount(2);
	await expect(page.getByTestId('document-file-viewer')).toContainText('KOBY-BASIC-PDF-2-PAGES');
	await expect(page.getByLabel('Reset zoom')).toHaveText('100%');
	await expect
		.poll(() =>
			page.getByRole('region', { name: /PDF document/ }).evaluate((element) => ({
				left: element.scrollLeft,
				top: element.scrollTop
			}))
		)
		.toEqual({ left: 0, top: 0 });
});

test('keeps ten file tabs while mounting only the active viewer', async ({ page }) => {
	await page.goto('/?workspace-lru=1');

	for (let index = 1; index <= 10; index += 1) {
		await page.getByRole('button', { name: `Open sequence-${index}.pdf` }).click();
		const expected = Array.from(
			{ length: index },
			(_, offset) => `workspace:file:/mnt/uploads/sequence-${offset + 1}.pdf`
		);
		await expect(page.getByTestId('lru-open-file-ids')).toHaveText(expected.join(','));
		await expect(page.getByTestId('lru-active-file-id')).toHaveText(expected.at(-1)!);
		await expect(page.getByTestId('document-file-viewer')).toHaveCount(1);
	}

	await page.getByRole('tab', { name: 'sequence-1.pdf', exact: true }).click();
	await expect(page.getByTestId('document-file-viewer')).toHaveCount(1);
	await expect(page.getByTestId('document-file-viewer')).toHaveAttribute(
		'data-document-path',
		'/mnt/uploads/sequence-1.pdf'
	);
	await expect(page.getByRole('tab')).toHaveCount(10);
});

test('commits only the latest delayed refresh candidate for rendering and download', async ({
	page
}) => {
	await page.goto('/?format=pdf');
	await expect(page.getByText('KOBY-BASIC-PDF-2-PAGES')).toBeVisible();
	await setRuntime(page, paths.pdf, { mode: 'valid', revision: 'a', delayMs: 600 });
	const staleRequest = page.waitForRequest(
		(request) =>
			new URL(request.url()).pathname === '/runtime/files/view' &&
			new URL(request.url()).searchParams.get('path') === paths.pdf
	);
	await page.getByTestId('refresh-viewer').click();
	await staleRequest;
	await setRuntime(page, paths.pdf, { mode: 'valid', revision: 'b', delayMs: 0 });
	const latestResponse = page.waitForResponse(
		(response) =>
			new URL(response.url()).pathname === '/runtime/files/view' &&
			new URL(response.url()).searchParams.get('path') === paths.pdf &&
			response.headers()['x-viewer-revision'] === 'b'
	);
	await page.getByTestId('refresh-viewer').click();
	await latestResponse;
	await expect(page.getByText('KOBY-REFRESH-VERSION-B')).toBeVisible();
	const downloadPromise = page.waitForEvent('download');
	await page.getByLabel('Download displayed version').click();
	const downloaded = await readFile(await (await downloadPromise).path());
	expect(downloaded.toString()).toContain('KOBY-REFRESH-VERSION-B');
	expect(downloaded.toString()).not.toContain('KOBY-REFRESH-VERSION-A');
});

test('opens unsupported binary files in their own download-only tab', async ({ page }) => {
	for (const extension of ['odt', 'ods', 'odp', 'doc', 'ppt']) {
		await page.goto(`/?unsupported=${extension}`);
		await expect(page.getByRole('tab', { name: `example.${extension}` })).toHaveAttribute(
			'aria-selected',
			'true'
		);
		await expect(page.getByText('Preview not available')).toBeVisible();
		const downloaded = page.waitForEvent('download');
		await page.getByLabel('Download displayed version').click();
		expect(await readFile(await (await downloaded).path())).toEqual(Buffer.from([0, 1, 2, 255]));
	}
});

test('renders Markdown and code in file tabs and refreshes text without stale downloads', async ({
	page
}) => {
	await page.goto('/?unsupported=md');
	await expect(page.getByRole('heading', { name: 'Notes' })).toBeVisible();
	await expect(page.locator('strong')).toContainText(['Viewer harness', 'formatted']);
	await page.goto('/?unsupported=py');
	await expect(page.locator('.cm-content')).toHaveAttribute('contenteditable', 'false');
	await expect(page.locator('.cm-content')).toContainText('Read only');
	await setRuntime(page, '/mnt/uploads/example.txt', { mode: 'valid', revision: 'a' });
	await page.goto('/?unsupported=txt');
	await expect(page.getByText('KOBY-REFRESH-VERSION-A')).toBeVisible();
	await setRuntime(page, '/mnt/uploads/example.txt', { mode: 'valid', revision: 'b' });
	await page.getByTestId('refresh-viewer').click();
	await expect(page.getByText('KOBY-REFRESH-VERSION-B')).toBeVisible();
	const downloaded = page.waitForEvent('download');
	await page.getByLabel('Download displayed version').click();
	expect((await readFile(await (await downloaded).path())).toString()).toBe(
		'KOBY-REFRESH-VERSION-B'
	);
	await page.getByTestId('delete-viewer').click();
	await expect(page.getByText('This file is no longer available.')).toBeVisible();
	await expect(page.getByLabel('Download displayed version')).toHaveCount(0);
});

test('rejects an oversized Pyodide response from its header before rendering', async ({ page }) => {
	await setRuntime(page, paths.pdf, { mode: 'oversized' });
	const oversizedResponse = viewerResponse(page, paths.pdf, 1);
	await page.goto('/?format=pdf');
	await oversizedResponse;
	await expect(page.getByText('This document is too large to display here.')).toBeVisible();
	await expect(page.locator('.pdf-page-wrapper')).toHaveCount(0);
	await expect(page.getByLabel('Download displayed version')).toHaveCount(0);
	await expect(page.getByRole('button', { name: 'Download', exact: true })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Try again', exact: true })).toHaveCount(0);
});

for (const source of ['workspace', 'saved'] as const) {
	test(`downloads an oversized ${source} file without rendering it or retrying the preview`, async ({
		page
	}) => {
		const bytes = Buffer.alloc(16 * 1024 * 1024 + 1, 'x');
		let reads = 0;
		if (source === 'workspace') {
			await page.route('**/runtime/files/view?**', (route) => {
				reads += 1;
				return route.fulfill({ body: bytes, contentType: 'text/csv' });
			});
		}
		await page.setViewportSize({ width: 390, height: 844 });
		await page.goto(`/?format=csv&theme=dark${source === 'saved' ? '&fileId=oversized-test' : ''}`);
		await expect(page.getByText('This document is too large to display here.')).toBeVisible();
		await expect(page.getByRole('button', { name: 'Try again', exact: true })).toHaveCount(0);
		const downloadButton = page.getByRole('button', { name: 'Download', exact: true });
		await expect(downloadButton).toBeVisible();
		if (source === 'workspace') expect(reads).toBe(1);
		await page.screenshot({ path: test.info().outputPath(`oversized-${source}.png`) });
		const downloaded = page.waitForEvent('download');
		await downloadButton.click();
		const file = await downloaded;
		expect(file.suggestedFilename()).toBe('basic.csv');
		expect(
			createHash('sha256')
				.update(await readFile(await file.path()))
				.digest('hex')
		).toBe(createHash('sha256').update(bytes).digest('hex'));
		await expect(page.locator('.office-sheet')).toHaveCount(0);
		await expect(page.getByLabel('Download displayed version')).toHaveCount(0);
		await expect(downloadButton).toBeEnabled();
		if (source === 'workspace') expect(reads).toBe(2);
		else expect(file.url()).toContain('/api/v1/files/oversized-test/content?attachment=true');
	});
}

test('keeps the displayed snapshot when a refresh is oversized and downloads the original separately', async ({
	page
}) => {
	const original = Buffer.from('city,value\nBasel,1\n');
	let bytes = original;
	await page.route('**/runtime/files/view?**', (route) => route.fulfill({ body: bytes }));
	await page.goto('/?format=csv');
	await expect(page.getByRole('cell', { name: 'Basel', exact: true })).toBeVisible();
	bytes = Buffer.alloc(16 * 1024 * 1024 + 1, 'x');
	await page.getByTestId('refresh-viewer').click();
	await expect(page.getByRole('button', { name: 'Download', exact: true })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Try again', exact: true })).toHaveCount(0);
	for (const [label, expected] of [
		['Download displayed version', original],
		['Download', bytes]
	] as const) {
		const downloaded = page.waitForEvent('download');
		await page.getByRole('button', { name: label, exact: true }).click();
		expect(
			createHash('sha256')
				.update(await readFile(await (await downloaded).path()))
				.digest('hex')
		).toBe(createHash('sha256').update(expected).digest('hex'));
		await expect(page.getByRole('cell', { name: 'Basel', exact: true })).toBeVisible();
	}
});

for (const action of ['deleted', 'closed']) {
	test(`recovers a failed oversized download and cancels it when the file is ${action}`, async ({
		page
	}) => {
		const bytes = Buffer.alloc(16 * 1024 * 1024 + 1, 'x');
		let fail = false;
		let hold = false;
		let release: (() => void) | undefined;
		let downloads = 0;
		page.on('download', () => downloads++);
		await page.route('**/runtime/files/view?**', async (route) => {
			if (fail) return route.fulfill({ status: 503 });
			if (hold)
				await new Promise<void>((resolve) => {
					release = resolve;
				});
			return route.fulfill({ body: bytes });
		});
		await page.goto(action === 'closed' ? '/?unsupported=txt' : '/?format=csv');
		const downloadButton = page.getByRole('button', { name: 'Download', exact: true });
		await expect(downloadButton).toBeVisible();
		fail = true;
		await downloadButton.click();
		await expect(page.getByText('Download failed', { exact: true })).toBeVisible();
		await expect(downloadButton).toBeEnabled();
		fail = false;
		const downloaded = page.waitForEvent('download');
		await downloadButton.click();
		await downloaded;
		await expect(page.getByText('Download failed', { exact: true })).toHaveCount(0);
		hold = true;
		await downloadButton.click();
		await expect(downloadButton).toBeDisabled();
		await expect(downloadButton).toHaveAttribute('aria-busy', 'true');
		await expect.poll(() => Boolean(release)).toBe(true);
		if (action === 'closed') {
			await page.getByRole('button', { name: 'Close: example.txt', exact: true }).click();
			await expect(page.getByTestId('document-file-viewer')).toHaveCount(0);
		} else {
			await page.getByTestId('delete-viewer').click();
			await expect(page.getByText('This file is no longer available.')).toBeVisible();
		}
		const reply = page.waitForResponse('**/runtime/files/view?**');
		release!();
		await (await reply).finished();
		if (action === 'deleted')
			await expect(page.getByRole('button', { name: 'Try again', exact: true })).toBeVisible();
		await expect(downloadButton).toHaveCount(0);
		expect(downloads).toBe(1);
	});
}

for (const format of ['pdf', 'docx', 'pptx', 'csv']) {
	test(`has no narrow viewport clipping for ${format} in either theme`, async ({ page }) => {
		for (const width of [320, 390]) {
			await page.setViewportSize({ width, height: 844 });
			for (const theme of ['light', 'dark']) {
				await page.goto(`/?format=${format}&theme=${theme}`);
				await expect(page.getByLabel('Download displayed version')).toBeVisible();
				const viewer = page.getByTestId('document-file-viewer');
				const box = await viewer.boundingBox();
				expect(box!.width).toBeLessThanOrEqual(width);
				if (format === 'docx') {
					await expect
						.poll(() =>
							page
								.getByRole('region', { name: 'Word document', exact: true })
								.evaluate((element) => element.scrollWidth - element.clientWidth)
						)
						.toBeLessThanOrEqual(1);
				}
				if (format === 'pptx') {
					const slide = await page.getByRole('img', { name: 'Slide 1', exact: true }).boundingBox();
					expect(slide!.x).toBeGreaterThanOrEqual(box!.x);
					expect(slide!.x + slide!.width).toBeLessThanOrEqual(box!.x + box!.width);
				}
				await page.screenshot({ path: test.info().outputPath(`${format}-${width}-${theme}.png`) });
			}
		}
	});
}
