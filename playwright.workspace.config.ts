import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
	testDir: './tests/workspace',
	outputDir: './.tmp/workspace-e2e-results',
	reporter: [['list'], ['json', { outputFile: './.tmp/workspace-e2e-results/report.json' }]],
	timeout: 45_000,
	fullyParallel: false,
	workers: 1,
	use: {
		baseURL: process.env.WORKSPACE_E2E_BASE_URL ?? 'http://127.0.0.1:5050',
		trace: 'retain-on-failure',
		screenshot: 'only-on-failure'
	},
	projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }]
});
