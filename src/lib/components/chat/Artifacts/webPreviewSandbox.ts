export const buildWebPreviewSandbox = (options: {
	allowForms: boolean;
	allowSameOrigin?: boolean;
	allowScripts?: boolean;
	allowDownloads?: boolean;
}) => [
	options.allowScripts !== false ? 'allow-scripts' : '',
	options.allowDownloads !== false ? 'allow-downloads' : '',
	options.allowForms ? 'allow-forms' : ''
].filter(Boolean).join(' ');

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
