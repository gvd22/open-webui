export type PreviewDiagnostic = { message: string; file: string };
export const readPreviewDiagnostic = (data: unknown, channel: string): PreviewDiagnostic | null => {
	if (!data || typeof data !== 'object') return null;
	const value = data as Record<string, unknown>;
	if (
		value.type !== 'preview-diagnostic' ||
		value.channel !== channel ||
		typeof value.message !== 'string' ||
		typeof value.file !== 'string'
	)
		return null;
	return {
		message: value.message.slice(0, 600),
		file: value.file.split(/[?#]/, 1)[0].slice(0, 200)
	};
};

export const instrumentPreview = (html: string, channel: string) => {
	const key = JSON.stringify(channel).replace(/</g, '\\u003c');
	const script = `<script>(() => {
  let count = 0;
  const report = (message, file = '') => {
    if (count++ >= 20) return;
    parent.postMessage({ type: 'preview-diagnostic', channel: ${key}, message: String(message).slice(0, 600), file: String(file).split(/[?#]/)[0].slice(0, 200) }, '*');
  };
  addEventListener('error', event => {
    if (event.target !== window) report('Resource could not be loaded', event.target?.getAttribute?.('src') || event.target?.getAttribute?.('href') || '');
    else report(event.message || 'JavaScript error', event.filename || '');
  }, true);
  addEventListener('unhandledrejection', event => report(typeof event.reason === 'string' ? event.reason : event.reason?.message || 'Unhandled promise rejection'));
  addEventListener('securitypolicyviolation', event => report('Blocked by preview policy: ' + event.violatedDirective, event.blockedURI));
  addEventListener('preview-resource-error', event => report('Preview file not found', event.detail));
})();<\/script>`;
	return /<head\b[^>]*>/i.test(html)
		? html.replace(/<head\b[^>]*>/i, (head) => head + script)
		: script + html;
};
