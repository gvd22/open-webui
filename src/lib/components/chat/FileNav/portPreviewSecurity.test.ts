import { describe, expect, it } from 'vitest';

import { getPortPreviewFrameBlockReason } from './portPreviewSecurity';

const headers = (values: Record<string, string>) => ({
	get: (name: string) => values[name.toLowerCase()] ?? null
});

const previewUrl = 'https://webui.example/api/v1/terminals/runtime/proxy/8080/';
const parentOrigin = 'https://webui.example';

describe('port preview frame policy', () => {
	it('blocks explicit X-Frame-Options denial', () => {
		expect(
			getPortPreviewFrameBlockReason(
				headers({ 'x-frame-options': 'DENY' }),
				previewUrl,
				parentOrigin
			)
		).toBe('x-frame-options');
	});

	it('allows same-origin framing declarations through the authenticated proxy', () => {
		expect(
			getPortPreviewFrameBlockReason(
				headers({ 'x-frame-options': 'SAMEORIGIN' }),
				previewUrl,
				parentOrigin
			)
		).toBeNull();
		expect(
			getPortPreviewFrameBlockReason(
				headers({ 'content-security-policy': "default-src 'self'; frame-ancestors 'self'" }),
				previewUrl,
				parentOrigin
			)
		).toBeNull();
	});

	it('blocks restrictive frame-ancestors policies', () => {
		expect(
			getPortPreviewFrameBlockReason(
				headers({ 'content-security-policy': "frame-ancestors 'none'" }),
				previewUrl,
				parentOrigin
			)
		).toBe('frame-ancestors');
		expect(
			getPortPreviewFrameBlockReason(
				headers({ 'content-security-policy': 'frame-ancestors https://other.example' }),
				previewUrl,
				parentOrigin
			)
		).toBe('frame-ancestors');
	});
});
