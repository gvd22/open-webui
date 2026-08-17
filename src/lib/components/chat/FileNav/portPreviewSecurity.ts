export type PortPreviewFrameBlockReason = 'x-frame-options' | 'frame-ancestors';

export const getPortPreviewFrameBlockReason = (
	headers: Pick<Headers, 'get'>,
	previewUrl: string,
	parentOrigin: string
): PortPreviewFrameBlockReason | null => {
	const previewOrigin = new URL(previewUrl, parentOrigin).origin;
	const xFrameOptions = (headers.get('x-frame-options') ?? '').trim().toLowerCase();
	if (xFrameOptions === 'deny') return 'x-frame-options';
	if (xFrameOptions && xFrameOptions !== 'sameorigin') return 'x-frame-options';
	if (xFrameOptions === 'sameorigin' && previewOrigin !== parentOrigin) return 'x-frame-options';

	const policy = headers.get('content-security-policy') ?? '';
	const directive = policy
		.split(';')
		.map((part) => part.trim())
		.find((part) => part.toLowerCase().startsWith('frame-ancestors'));
	if (!directive) return null;

	const sources = directive.split(/\s+/).slice(1);
	if (sources.includes("'none'")) return 'frame-ancestors';
	if (sources.includes('*')) return null;
	if (sources.includes("'self'") && previewOrigin === parentOrigin) return null;
	if (sources.includes(parentOrigin)) return null;
	return 'frame-ancestors';
};
