import { describe, expect, it } from 'vitest';

import { buildWebPreviewSandbox } from './webPreviewSandbox';

describe('buildWebPreviewSandbox', () => {
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
});
