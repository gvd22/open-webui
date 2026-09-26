import { expect, test, type Page } from '@playwright/test';

const start = async (page: Page, url = '/?code-interpreter=true') => {
	await page.goto(url);
	await page.locator('#splash-screen').waitFor({ state: 'hidden' });
	const release = page.getByRole('dialog').filter({ hasText: "What's New in Open WebUI" });
	if (
		await release.waitFor({ state: 'visible', timeout: 3000 }).then(
			() => true,
			() => false
		)
	) {
		await release.getByRole('button', { name: 'Close', exact: true }).click();
	}
};

const openFiles = async (page: Page) => {
	await page.getByRole('button', { name: 'Files', exact: true }).click();
	const files = page.getByRole('region', { name: 'Pyodide file browser' });
	await expect(files).toBeVisible();
	await expect(files.getByRole('status')).toHaveCount(0, { timeout: 90_000 });
	return files;
};

test('opens, uploads, previews, switches and closes files through the real app UI', async ({
	page
}) => {
	const errors: string[] = [];
	page.on('pageerror', (error) => errors.push(error.message));
	await start(page);
	const files = await openFiles(page);
	const fixedTab = page.getByRole('tab', { name: 'Files', exact: true });
	await expect(fixedTab).not.toHaveAttribute('data-workspace-id');
	await files.getByRole('button', { name: 'Actions', exact: true }).last().click();
	const chooser = page.waitForEvent('filechooser');
	await page.getByRole('menu').getByRole('button', { name: 'Upload', exact: true }).click();
	await (
		await chooser
	).setFiles([
		{ name: 'cities.csv', mimeType: 'text/csv', buffer: Buffer.from('City,Value\nBasel,42\n') },
		{
			name: 'notes.md',
			mimeType: 'text/markdown',
			buffer: Buffer.from('# Notes\n\n**Formatted text**')
		},
		{ name: 'code.py', mimeType: 'text/plain', buffer: Buffer.from('print("hello")') }
	]);
	const row = (name: string) => files.locator('[data-file-row]').filter({ hasText: name });
	await expect(row('cities.csv')).toBeVisible();
	await row('cities.csv').getByRole('button').first().click();
	await expect(page.getByRole('cell', { name: 'Basel', exact: true })).toBeVisible();
	await fixedTab.click();
	await row('notes.md').getByRole('button').first().click();
	await expect(page.getByRole('heading', { name: 'Notes', exact: true })).toBeVisible();
	await fixedTab.click();
	await row('code.py').getByRole('button').first().click();
	await expect(page.getByRole('tab')).toHaveCount(4);
	await expect(page.locator('#files-workspace .cm-content')).toContainText('print("hello")');
	await fixedTab.click();
	await row('cities.csv').getByRole('button').first().click();
	await expect(page.getByRole('tab')).toHaveCount(4);
	await page.getByRole('button', { name: 'Close: notes.md', exact: true }).press('Enter');
	await expect(page.getByRole('tab', { name: 'notes.md', exact: true })).toHaveCount(0);
	await expect(page.getByRole('tab', { name: 'code.py', exact: true })).toBeFocused();
	await page
		.getByTestId('workspace-tabs')
		.getByRole('button', { name: 'Close', exact: true })
		.click();
	await expect(page.locator('#files-workspace')).toHaveCount(0);
	await openFiles(page);
	await expect(page.getByRole('tab')).toHaveCount(3);
	await expect(row('cities.csv')).toBeVisible();
	for (const width of [1440, 390]) {
		await page.setViewportSize({ width, height: 900 });
		if (!(await files.isVisible())) await openFiles(page);
		for (const dark of [false, true]) {
			await page.evaluate(
				(value) => document.documentElement.classList.toggle('dark', value),
				dark
			);
			await expect(row('cities.csv')).toBeVisible();
			const bounds = await files.boundingBox();
			const rowBounds = await row('cities.csv').boundingBox();
			expect(rowBounds!.x).toBeGreaterThan(bounds!.x);
			expect(rowBounds!.x + rowBounds!.width).toBeLessThan(bounds!.x + bounds!.width);
			await page.screenshot({
				path: test.info().outputPath(`files-${width}-${dark ? 'dark' : 'light'}.png`)
			});
		}
	}
	expect(errors).toEqual([]);
});

test('opens Files in a fresh mobile chat before any document exists', async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await start(page);
	await openFiles(page);
	await expect(page.getByRole('tab', { name: 'Files', exact: true })).toHaveAttribute(
		'aria-selected',
		'true'
	);
	await page
		.getByTestId('workspace-tabs')
		.getByRole('button', { name: 'Close', exact: true })
		.click();
	await expect(page.locator('#files-workspace')).toHaveCount(0);
});

test('disables the entry point without Python and with Jupyter', async ({ page }) => {
	await start(page, '/');
	await expect(page.getByRole('button', { name: 'Files', exact: true })).toHaveCount(0);
	await page.route('**/api/config', async (route) => {
		const response = await route.fetch();
		const config = await response.json();
		config.code = { ...config.code, interpreter_engine: 'jupyter' };
		await route.fulfill({ response, json: config });
	});
	await start(page);
	await expect(page.getByRole('button', { name: 'Files', exact: true })).toHaveCount(0);
});

test('persists file tabs per saved chat and ignores delayed requests from another chat', async ({
	page
}) => {
	await start(page);
	await openFiles(page);
	await page.evaluate(async () => {
		const stores = await import(['/src/lib/stores', 'index.ts'].join('/'));
		stores.showFileNavPath.set('/mnt/uploads/first.txt');
	});
	await expect(page.getByRole('tab', { name: 'first.txt', exact: true })).toBeVisible();
	await page.evaluate(async () => {
		(await import(['/src/lib/stores', 'index.ts'].join('/'))).chatId.set('files-test-a');
	});
	await expect(page.getByRole('tab', { name: 'first.txt', exact: true })).toBeVisible();
	await page.evaluate(async () => {
		(await import(['/src/lib/stores', 'index.ts'].join('/'))).chatId.set('files-test-b');
	});
	await expect(page.getByRole('tab')).toHaveCount(1);
	await page.evaluate(async () => {
		const stores = await import(['/src/lib/stores', 'index.ts'].join('/'));
		stores.showFileNavPath.set({ path: '/mnt/uploads/stale.txt', chatId: 'files-test-a' });
	});
	await expect(page.getByRole('tab')).toHaveCount(1);
	await page.evaluate(async () => {
		(await import(['/src/lib/stores', 'index.ts'].join('/'))).chatId.set('files-test-a');
	});
	await expect(page.getByRole('tab', { name: 'first.txt', exact: true })).toBeVisible();
	await expect(page.getByRole('tab', { name: 'Files', exact: true })).toHaveAttribute(
		'aria-selected',
		'true'
	);
});
