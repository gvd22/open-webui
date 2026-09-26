import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.FILES_TEST_URL ?? 'http://127.0.0.1:5175';
if (!['localhost', '127.0.0.1'].includes(new URL(baseURL).hostname)) {
	throw new Error('Files integration tests require an isolated local, no-auth test server.');
}

export default defineConfig({
	testDir: '.',
	outputDir: '../../.tmp/files-e2e-results',
	timeout: 120_000,
	expect: { timeout: 15_000 },
	workers: 1,
	use: { baseURL, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
	projects: [
		{
			name: 'chromium',
			use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } }
		}
	]
});
