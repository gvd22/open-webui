import { expect, type Page } from '@playwright/test';

export const dismissReleaseNotes = async (page: Page) => {
	await page.locator('#splash-screen').waitFor({ state: 'hidden', timeout: 30_000 });

	const dialog = page.getByRole('dialog').filter({ hasText: "What's New in Open WebUI" });
	const appeared = await dialog
		.waitFor({ state: 'visible', timeout: 5_000 })
		.then(() => true)
		.catch(() => false);

	if (appeared) {
		await dialog.getByRole('button', { name: 'Close' }).click();
		await expect(dialog).toHaveCount(0);
	}
};
