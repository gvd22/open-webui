import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
	testDir: './tests/document-viewer',
	timeout: 45_000,
	fullyParallel: false,
	workers: 1,
	use: {
		baseURL: 'http://127.0.0.1:4175',
		serviceWorkers: 'block',
		trace: 'retain-on-failure',
		screenshot: 'only-on-failure'
	},
	projects: [
		{ name: 'chromium', use: { ...devices['Desktop Chrome'] } },
		{ name: 'firefox', use: { ...devices['Desktop Firefox'] } },
		{ name: 'webkit', use: { ...devices['Desktop Safari'] } }
	],
	webServer: {
		command:
			'vite --config tests/document-viewer/harness/vite.config.ts --host 127.0.0.1 --port 4175',
		url: 'http://127.0.0.1:4175',
		reuseExistingServer: false
	}
});
