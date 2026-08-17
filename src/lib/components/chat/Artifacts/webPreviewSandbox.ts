export const buildWebPreviewSandbox = (options: {
	allowForms: boolean;
	allowSameOrigin?: boolean;
}) => `allow-scripts allow-downloads${options.allowForms ? ' allow-forms' : ''}`;

export const DEFAULT_WEB_PREVIEW_CSP = [
	"default-src 'none'",
	"script-src 'unsafe-inline'",
	"style-src 'unsafe-inline'",
	'img-src data: blob:',
	'media-src data: blob:',
	'font-src data:'
].join('; ');

export const resolveWebPreviewCsp = (configuredCsp: string) =>
	configuredCsp.trim() || DEFAULT_WEB_PREVIEW_CSP;
