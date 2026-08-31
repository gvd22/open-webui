import { createMessagesList } from '$lib/utils';

export type WebPreviewFile = { content: string; mime: string };
export type WebPreviewArtifact = {
	type: 'web-preview';
	title: string;
	content: string;
	previewId: string;
	entrypoint: string;
	files: Record<string, WebPreviewFile>;
	updatedAt?: number;
	contentHash?: string;
	exportedPath?: string;
	exportedRuntime?: 'terminal' | 'pyodide';
	hasFilePayload?: boolean;
	source: 'tool' | 'legacy';
};

const getToolOutputText = (item: any) => {
	const output = item?.output ?? item?.content ?? [];
	const parts =
		typeof output === 'string' ? [{ text: output }] : Array.isArray(output) ? output : [output];
	return parts
		.map((part: any) => String(part?.text ?? part?.content ?? ''))
		.join('')
		.trim();
};

export const generateWebPreviewTitle = (
	files: Record<string, WebPreviewFile>,
	entrypoint = 'index.html',
	fallback = ''
) => {
	if (fallback.trim()) return fallback.trim().slice(0, 48);
	const html = files[entrypoint]?.content ?? '';
	const candidate =
		html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ??
		html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ??
		'';
	const clean = candidate
		.replace(/<[^>]+>/g, '')
		.replace(/\s+/g, ' ')
		.trim();
	if (clean) return clean.length > 48 ? `${clean.slice(0, 45).trim()}...` : clean;
	const filename = entrypoint
		.split('/')
		.at(-1)
		?.replace(/\.[^.]+$/, '')
		.replace(/[-_]/g, ' ');
	return filename && filename !== 'index' ? filename : 'Web Preview';
};

const normalizeDocument = (value: any): WebPreviewArtifact | null => {
	if (value?.type !== 'web_preview.document' || !value?.previewId) return null;
	const hasFilePayload = Boolean(value.files && Object.keys(value.files).length > 0);
	const files = Object.fromEntries(
		Object.entries(value.files ?? {}).map(([path, file]: [string, any]) => [
			path,
			{
				content: typeof file === 'string' ? file : String(file?.content ?? ''),
				mime: typeof file === 'string' ? 'text/plain' : String(file?.mime ?? 'text/plain')
			}
		])
	) as Record<string, WebPreviewFile>;
	const entrypoint = String(value.entrypoint ?? 'index.html');
	return {
		type: 'web-preview',
		title: generateWebPreviewTitle(files, entrypoint, value.title ?? ''),
		content: files[entrypoint]?.content ?? '',
		previewId: value.previewId,
		entrypoint,
		files,
		updatedAt: Number(value.updatedAt ?? 0),
		contentHash: value.contentHash ?? undefined,
		exportedPath: value.exportedPath ?? undefined,
		exportedRuntime: value.exportedRuntime ?? undefined,
		hasFilePayload,
		source: 'tool'
	};
};

export const getWebPreviewsFromOutput = (output: any[] = []): WebPreviewArtifact[] =>
	output
		.filter((item) => item?.type === 'function_call_output')
		.flatMap((item) => {
			try {
				const parsed = JSON.parse(getToolOutputText(item));
				return (Array.isArray(parsed) ? parsed : [parsed])
					.map(normalizeDocument)
					.filter((artifact): artifact is WebPreviewArtifact => artifact !== null);
			} catch {
				return [];
			}
		});

export const getWebPreviewErrorFromOutput = (output: any[] = []) => {
	for (const item of output) {
		if (item?.type !== 'function_call_output') continue;
		try {
			const parsed = JSON.parse(getToolOutputText(item));
			if (['web_preview.error', 'web_preview.conflict'].includes(parsed?.type)) return String(parsed.message ?? '');
		} catch {
			// Other tool output belongs to the generic renderer.
		}
	}
	return '';
};

export const getWebPreviewsFromHistory = (history: any): WebPreviewArtifact[] => {
	if (!history?.messages || history.currentId === undefined || history.currentId === null)
		return [];
	const previews = new Map<string, WebPreviewArtifact>();
	for (const message of createMessagesList(history, history.currentId)) {
		if (message?.role === 'user') continue;
		for (const preview of getWebPreviewsFromOutput(message?.output ?? [])) {
			const previous = previews.get(preview.previewId);
			const files = preview.hasFilePayload ? preview.files : (previous?.files ?? {});
			previews.set(preview.previewId, {
				...previous,
				...preview,
				files,
				content: files[preview.entrypoint]?.content ?? previous?.content ?? ''
			});
		}
	}
	return Array.from(previews.values());
};

export const dedupeWebPreviewArtifacts = (
	items: WebPreviewArtifact[],
	previousIds: string[] = []
) => {
	const seen = new Set(previousIds);
	return items.filter((item) => {
		if (seen.has(item.previewId)) return false;
		seen.add(item.previewId);
		return true;
	});
};

export const findNewToolWebPreview = (items: WebPreviewArtifact[], knownIds: ReadonlySet<string>) =>
	items.find((item) => item.source === 'tool' && !knownIds.has(item.previewId));

const dataUrl = (file: WebPreviewFile) =>
	`data:${file.mime || 'text/plain'};charset=utf-8,${encodeURIComponent(file.content)}`;

const resolvePreviewPath = (reference: string, fromPath: string) => {
	if (/^(?:[a-z]+:|\/\/|#|data:|blob:)/i.test(reference)) return null;
	const base = fromPath.split('/').slice(0, -1);
	for (const part of reference.split(/[?#]/, 1)[0].replace(/^\.\//, '').split('/')) {
		if (!part || part === '.') continue;
		if (part === '..') base.pop();
		else base.push(part);
	}
	return base.join('/');
};

const replaceLocalReferences = (
	value: string,
	fromPath: string,
	files: Record<string, WebPreviewFile>
) =>
	value.replace(/(src|href)=(['"])([^'"]+)\2/gi, (match, attribute, quote, reference) => {
		const path = resolvePreviewPath(reference, fromPath);
		const file = path ? files[path] : undefined;
		return file && !['text/css', 'text/javascript'].includes(file.mime)
			? `${attribute}=${quote}${dataUrl(file)}${quote}`
			: match;
	});

const inlineCssAssets = (css: string, fromPath: string, files: Record<string, WebPreviewFile>) =>
	css.replace(/url\((['"]?)([^)'"\s]+)\1\)/gi, (match, _quote, reference) => {
		const path = resolvePreviewPath(reference, fromPath);
		return path && files[path] ? `url("${dataUrl(files[path])}")` : match;
	});

const isJavaScriptMime = (mime: string) =>
	[
		'text/javascript',
		'application/javascript',
		'text/ecmascript',
		'application/ecmascript'
	].includes(mime.toLowerCase().split(';', 1)[0].trim());

const virtualFetchScript = (files: Record<string, WebPreviewFile>, entrypoint: string) => {
	// The registry is data, not executable markup, even when a file contains a closing script tag.
	const registry = JSON.stringify({ files, entrypoint }).replace(/</g, '\\u003c');
	return `<script data-preview-runtime="files">(() => {
  const registry = ${registry};
  const nativeFetch = window.fetch.bind(window);
  const base = new URL(registry.entrypoint, 'https://web-preview.invalid/');
  window.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input), base);
    if (url.origin !== base.origin) return nativeFetch(input, init);
    const method = String(init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
    if (!['GET', 'HEAD'].includes(method)) return new Response('Preview files are read-only', { status: 405 });
    let path;
    try { path = decodeURIComponent(url.pathname.slice(1)); }
    catch { return new Response('Invalid preview file path', { status: 400 }); }
    const file = Object.prototype.hasOwnProperty.call(registry.files, path) ? registry.files[path] : null;
    if (!file) return new Response('Preview file not found: ' + path, { status: 404 });
    return new Response(method === 'HEAD' ? null : file.content, { headers: { 'Content-Type': file.mime || 'text/plain' } });
  };
})();<\/script>`;
};

export const composeWebPreviewHtml = (
	files: Record<string, WebPreviewFile>,
	entrypoint = 'index.html'
) => {
	let html = files[entrypoint]?.content ?? '';
	if (!html) return '';

	html = html.replace(
		/<link\b([^>]*?)href=(['"])([^'"]+)\2([^>]*)>/gi,
		(match, before, _quote, reference, after) => {
			const path = resolvePreviewPath(reference, entrypoint);
			const file = path ? files[path] : undefined;
			return path && file?.mime === 'text/css'
				? `<style data-preview-file="${path}">${inlineCssAssets(file.content, path, files)}</style>`
				: match;
		}
	);
	html = html.replace(
		/<script\b([^>]*?)src=(['"])([^'"]+)\2([^>]*)><\/script>/gi,
		(match, before, _quote, reference, after) => {
			const path = resolvePreviewPath(reference, entrypoint);
			const file = path ? files[path] : undefined;
			const attributes = `${before}${after}`.trim();
			return file && isJavaScriptMime(file.mime)
				? `<script${attributes ? ` ${attributes}` : ''} data-preview-file="${path}">${file.content}<\/script>`
				: match;
		}
	);
	html = replaceLocalReferences(html, entrypoint, files);
	const runtime = virtualFetchScript(files, entrypoint);
	return /<head\b[^>]*>/i.test(html)
		? html.replace(/<head\b[^>]*>/i, (head) => head + runtime)
		: runtime + html;
};

export const mergePersistedWebPreview = (
	artifact: WebPreviewArtifact,
	persisted: Record<string, any> | undefined
): WebPreviewArtifact => {
	if (!persisted || Number(persisted.updated_at ?? 0) < Number(artifact.updatedAt ?? 0))
		return artifact;
	const files = persisted.files ?? artifact.files;
	const entrypoint = persisted.entrypoint ?? artifact.entrypoint;
	return {
		...artifact,
		title: persisted.title ?? artifact.title,
		entrypoint,
		files,
		content: files[entrypoint]?.content ?? '',
		updatedAt: Number(persisted.updated_at ?? artifact.updatedAt ?? 0),
		contentHash: artifact.contentHash,
		exportedPath: persisted.exported_path ?? artifact.exportedPath,
		exportedRuntime: persisted.exported_runtime ?? artifact.exportedRuntime,
		hasFilePayload: true
	};
};

export const preserveNewerWebPreview = (
	incoming: WebPreviewArtifact,
	current?: WebPreviewArtifact
): WebPreviewArtifact =>
	current && current.hasFilePayload && Number(current.updatedAt ?? 0) > 0 &&
	Number(current.updatedAt ?? 0) >= Number(incoming.updatedAt ?? 0)
		? { ...incoming, ...current }
		: incoming;

export const mergeLocalWebPreviewDraft = (
	artifact: WebPreviewArtifact,
	draft: Pick<WebPreviewArtifact, 'title' | 'entrypoint' | 'files'>
): WebPreviewArtifact => ({
	...artifact,
	...draft,
	content: draft.files[draft.entrypoint]?.content ?? ''
});

export const getWebPreviewExportPath = (
	root: string, previewId: string, slug: string, previousPath = ''
) => {
	const base = `${root.replace(/\/$/, '')}/previews/`;
	if (previousPath.length > base.length && previousPath.startsWith(base) && !previousPath.split('/').some((part) => part === '..' || part === '.')) {
		return previousPath;
	}
	const id = previewId.replace(/[^a-zA-Z0-9_-]/g, '');
	if (!id) throw new Error('Preview identity is required for export');
	return `${base}${slug.replace(/[^a-z0-9-]/g, '') || 'web-preview'}-${id}`;
};
