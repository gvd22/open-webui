import { describe, expect, it } from 'vitest';

import {
	buildWebPreviewSandbox,
	DEFAULT_WEB_PREVIEW_CSP,
	resolveWebPreviewCsp
} from './webPreviewSandbox';

describe('buildWebPreviewSandbox', () => {
	it('honors native script and download restrictions independently', () => {
		expect(buildWebPreviewSandbox({ allowForms: false, allowScripts: false, allowDownloads: false })).toBe('');
		expect(buildWebPreviewSandbox({ allowForms: false, allowScripts: false })).toBe('allow-downloads');
		expect(buildWebPreviewSandbox({ allowForms: false, allowDownloads: false, allowSameOrigin: true })).toBe('allow-scripts');
	});
	it('allows scripts and downloads without granting same-origin access', () => {
		const sandbox = buildWebPreviewSandbox({ allowForms: false, allowSameOrigin: true });

		expect(sandbox).toBe('allow-scripts allow-downloads');
		expect(sandbox).not.toContain('allow-same-origin');
	});

	it('preserves optional form submission without granting same-origin access', () => {
		const sandbox = buildWebPreviewSandbox({ allowForms: true });

		expect(sandbox).toBe('allow-scripts allow-downloads allow-forms');
		expect(sandbox).not.toContain('allow-same-origin');
	});

	it('blocks network access unless an administrator provides another CSP', () => {
		expect(resolveWebPreviewCsp('')).toBe(DEFAULT_WEB_PREVIEW_CSP);
		expect(DEFAULT_WEB_PREVIEW_CSP).toContain("default-src 'none'");
		expect(DEFAULT_WEB_PREVIEW_CSP).not.toContain('http:');
		expect(resolveWebPreviewCsp("default-src 'self'")).toBe("default-src 'self'");
	});
});
