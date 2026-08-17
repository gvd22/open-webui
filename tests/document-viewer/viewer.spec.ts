import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const paths = {
	pdf: '/workspace/basic.pdf',
	docx: '/workspace/basic.docx',
	pptx: '/workspace/basic.pptx'
};

let blockedRequests: string[] = [];

const getRuntimeSessionId = (page: Page) =>
	`viewer-browser-test-${page.context().browser()?.browserType().name() ?? 'unknown'}`;

test.beforeEach(async ({ page }) => {
	blockedRequests = [];
	const runtimeSessionId = getRuntimeSessionId(page);
	await page.addInitScript((sessionId) => {
		localStorage.setItem('viewer-runtime-session', sessionId);
	}, runtimeSessionId);
	await page.route('**/*', async (route) => {
		const url = route.request().url();
		if (
			new URL(url).origin === 'http://127.0.0.1:4173' ||
			url.startsWith('blob:') ||
			url.startsWith('data:')
		) {
			return route.continue();
		}
		blockedRequests.push(url);
		await route.abort();
	});
	await page.routeWebSocket('**/*', (ws) => {
		if (new URL(ws.url()).host === '127.0.0.1:4173') return;
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
	const firstSlideTitle = page.getByText('KOBY-BASIC-PPTX-2-SLIDES');
	await expect(firstSlideTitle).toBeVisible();
	// A zero-sized shape remains accessible but produces a visually blank slide.
	expect((await firstSlideTitle.boundingBox())?.width).toBeGreaterThan(20);
	const initialPlacement = await page
		.getByTestId('powerpoint-document-viewport')
		.evaluate((viewport) => {
			const surface = viewport.querySelector<HTMLElement>('.presentation-render-surface');
			if (!surface) return null;
			const viewportRect = viewport.getBoundingClientRect();
			const surfaceRect = surface.getBoundingClientRect();
			return {
				left: viewport.scrollLeft,
				top: viewport.scrollTop,
				surfaceLeft: surfaceRect.left - viewportRect.left,
				surfaceTop: surfaceRect.top - viewportRect.top
			};
		});
	expect(initialPlacement).not.toBeNull();
	expect(initialPlacement).toEqual({ left: 0, top: 0, surfaceLeft: 0, surfaceTop: 0 });
	await page.getByLabel('PowerPoint presentation').focus();
	await page.keyboard.press('ArrowRight');
	await expect(page.getByText('2 / 2')).toBeVisible();
	const secondSlideTitle = page.getByText('KOBY profiling slide 2');
	await expect(secondSlideTitle).toBeVisible();
	expect((await secondSlideTitle.boundingBox())?.width).toBeGreaterThan(20);
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
	await expect(page.getByRole('alert')).toContainText('The latest update could not be displayed.');
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
	await expect(page.getByTestId('files-fallback-state')).toBeVisible();
	await expect(tabs).toHaveCount(2);
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

test('limits production workspace files to four with active-safe inactive LRU eviction', async ({
	page
}) => {
	await page.goto('/?workspace-lru=1');

	for (let index = 1; index <= 10; index += 1) {
		await page.getByRole('button', { name: `Open sequence-${index}.pdf` }).click();
		const expected = Array.from(
			{ length: Math.min(index, 4) },
			(_, offset) =>
				`workspace:file:/workspace/sequence-${index - Math.min(index, 4) + offset + 1}.pdf`
		);
		await expect(page.getByTestId('lru-open-file-ids')).toHaveText(expected.join(','));
		await expect(page.getByTestId('lru-active-file-id')).toHaveText(expected.at(-1)!);
		await expect(page.getByTestId('document-file-viewer')).toHaveCount(1);
	}

	await expect(page.getByTestId('lru-evicted-file-ids')).toHaveText(
		'workspace:file:/workspace/sequence-1.pdf,workspace:file:/workspace/sequence-2.pdf,workspace:file:/workspace/sequence-3.pdf,workspace:file:/workspace/sequence-4.pdf,workspace:file:/workspace/sequence-5.pdf,workspace:file:/workspace/sequence-6.pdf'
	);
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

test('keeps unsupported office and data formats in the visible Files fallback', async ({
	page
}) => {
	for (const extension of ['xlsx', 'xls', 'csv', 'odt', 'ods', 'odp', 'doc', 'ppt']) {
		await page.goto(`/?unsupported=${extension}`);
		await expect(page.getByTestId('files-fallback-state')).toHaveAttribute(
			'data-file-open-target',
			'files'
		);
		await expect(page.getByTestId('files-fallback-state')).toContainText(`example.${extension}`);
		await expect(page.getByTestId('document-file-viewer')).toHaveCount(0);
		await expect(page.locator('[role="tabpanel"]')).toHaveCount(0);
	}
});

test('rejects an oversized terminal response from its header before rendering', async ({
	page
}) => {
	await setRuntime(page, paths.pdf, { mode: 'oversized' });
	const oversizedResponse = viewerResponse(page, paths.pdf, 1);
	await page.goto('/?format=pdf');
	await oversizedResponse;
	await expect(page.getByText('This document is too large to display here.')).toBeVisible();
	await expect(page.locator('.pdf-page-wrapper')).toHaveCount(0);
	await expect(page.getByLabel('Download displayed version')).toHaveCount(0);
});

test('has no narrow viewport clipping in either stable theme', async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	for (const theme of ['light', 'dark']) {
		await page.goto(`/?format=pdf&theme=${theme}`);
		await expect(page.locator('.pdf-page-wrapper').first()).toBeVisible();
		const box = await page.getByTestId('document-file-viewer').boundingBox();
		expect(box?.width).toBeLessThanOrEqual(390);
	}
});
