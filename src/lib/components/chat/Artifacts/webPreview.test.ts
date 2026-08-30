import { describe, expect, it } from 'vitest';

import {
	composeWebPreviewHtml,
	findNewToolWebPreview,
	getWebPreviewsFromHistory,
	getWebPreviewsFromOutput,
	mergeLocalWebPreviewDraft,
	mergePersistedWebPreview,
	type WebPreviewArtifact
} from './webPreview';
import {
	buildOutputDisplayItems,
	dedupeWebPreviewDisplayItems,
	type OutputDisplayItem
} from '../Messages/structuredOutput';

const toolOutput = (previewId: string, title = 'Counter', heading = 'One') => ({
	type: 'function_call_output',
	output: JSON.stringify({
		type: 'web_preview.document',
		previewId,
		title,
		entrypoint: 'index.html',
		files: {
			'index.html': { content: `<title>${title}</title><h1>${heading}</h1>`, mime: 'text/html' },
			'styles.css': { content: 'h1 { color: red; }', mime: 'text/css' },
			'app.js': { content: 'document.body.dataset.ready = "yes";', mime: 'text/javascript' }
		},
		updatedAt: 10,
		contentHash: `hash-${previewId}`
	})
});

describe('Web Preview contract', () => {
	it('parses a stable multi-file tool result', () => {
		expect(getWebPreviewsFromOutput([toolOutput('preview-1')])[0]).toMatchObject({
			type: 'web-preview',
			previewId: 'preview-1',
			title: 'Counter',
			entrypoint: 'index.html',
			files: { 'app.js': { mime: 'text/javascript' } },
			contentHash: 'hash-preview-1'
		});
	});

	it('keeps the last file package when a later tool result is a compact reference', () => {
		const history = {
			currentId: 'assistant-2',
			messages: {
				'assistant-1': {
					id: 'assistant-1',
					role: 'assistant',
					parentId: null,
					output: [toolOutput('p1')]
				},
				'assistant-2': {
					id: 'assistant-2',
					role: 'assistant',
					parentId: 'assistant-1',
					output: [
						{
							type: 'function_call_output',
							output: JSON.stringify({
								type: 'web_preview.document',
								previewId: 'p1',
								title: 'Updated counter',
								entrypoint: 'index.html',
								updatedAt: 20
							})
						}
					]
				}
			}
		};

		expect(getWebPreviewsFromHistory(history)).toMatchObject([
			{
				previewId: 'p1',
				title: 'Updated counter',
				files: { 'index.html': { mime: 'text/html' } },
				hasFilePayload: false
			}
		]);
	});

	it('inlines local styles and scripts without a runtime', () => {
		const html = composeWebPreviewHtml(
			{
				'index.html': {
					content: '<link href="styles.css"><script src="app.js"></script>',
					mime: 'text/html'
				},
				'styles.css': { content: 'body { color: red; }', mime: 'text/css' },
				'app.js': { content: 'window.ready = true;', mime: 'text/javascript' }
			},
			'index.html'
		);
		expect(html).toContain('<style data-preview-file="styles.css">body { color: red; }</style>');
		expect(html).toContain('<script data-preview-file="app.js">window.ready = true;</script>');
	});

	it('inlines standard JavaScript MIME aliases', () => {
		const html = composeWebPreviewHtml({
			'index.html': {
				content: '<script src="app.js"></script>',
				mime: 'text/html'
			},
			'app.js': { content: 'window.ready = true;', mime: 'application/javascript; charset=utf-8' }
		});

		expect(html).toContain('<script data-preview-file="app.js">window.ready = true;</script>');
	});

	it('resolves nested relative styles, scripts, and assets', () => {
		const html = composeWebPreviewHtml(
			{
				'pages/index.html': {
					content:
						'<link href="../css/site.css"><img src="../assets/logo.svg"><script src="../js/app.js"></script>',
					mime: 'text/html'
				},
				'css/site.css': {
					content: 'body { background: url("../assets/logo.svg"); }',
					mime: 'text/css'
				},
				'js/app.js': { content: 'window.ready = true;', mime: 'text/javascript' },
				'assets/logo.svg': { content: '<svg></svg>', mime: 'image/svg+xml' }
			},
			'pages/index.html'
		);
		expect(html).toContain('data-preview-file="css/site.css"');
		expect(html).toContain('data:image/svg+xml');
		expect(html).toContain('data-preview-file="js/app.js"');
	});

	it('composes the latest edited code into the next preview document', () => {
		const files = {
			'index.html': {
				content: '<h1 id="status">Before</h1><script src="app.js"></script>',
				mime: 'text/html'
			},
			'app.js': { content: 'status.textContent = "Before";', mime: 'text/javascript' }
		};
		const edited = {
			...files,
			'app.js': { ...files['app.js'], content: 'status.textContent = "After";' }
		};

		expect(composeWebPreviewHtml(files)).toContain('status.textContent = "Before";');
		expect(composeWebPreviewHtml(edited)).toContain('status.textContent = "After";');
		expect(composeWebPreviewHtml(edited)).not.toContain('status.textContent = "Before";');
	});

	it('recovers the newest state for each preview from chat history', () => {
		const history = {
			currentId: 'assistant-2',
			messages: {
				user: { id: 'user', role: 'user', parentId: null },
				'assistant-1': {
					id: 'assistant-1',
					role: 'assistant',
					parentId: 'user',
					output: [toolOutput('p1')]
				},
				'assistant-2': {
					id: 'assistant-2',
					role: 'assistant',
					parentId: 'assistant-1',
					output: [toolOutput('p2', 'Second'), toolOutput('p1', 'Counter', 'Two')]
				}
			}
		};
		expect(getWebPreviewsFromHistory(history)).toMatchObject([
			{ previewId: 'p1', content: expect.stringContaining('Two') },
			{ previewId: 'p2', title: 'Second' }
		]);
	});

	it('keeps prose and tool activity in message order', () => {
		const output = buildOutputDisplayItems([
			{ type: 'message', id: 'before', content: [{ text: 'Before' }] },
			{ type: 'function_call', call_id: 'call-1', name: 'web_preview_create', status: 'completed' },
			{ ...toolOutput('preview-1'), call_id: 'call-1' },
			{ type: 'message', id: 'after', content: [{ text: 'After' }] }
		]);
		expect(output.map((item) => item.type)).toEqual([
			'message',
			'web_preview_activity',
			'web_preview',
			'message'
		]);
	});

	it('renders only the first chat card for each preview id', () => {
		const preview = getWebPreviewsFromOutput([toolOutput('preview-1')])[0];
		const item: OutputDisplayItem = {
			type: 'web_preview',
			id: preview.previewId,
			artifact: preview
		};
		expect(dedupeWebPreviewDisplayItems([item], ['preview-1'])).toEqual([]);
	});

	it('distinguishes a live tool creation from previews already loaded with the chat', () => {
		const existing = getWebPreviewsFromOutput([toolOutput('preview-1')])[0];
		const created = getWebPreviewsFromOutput([toolOutput('preview-2', 'Second')])[0];

		expect(findNewToolWebPreview([existing], new Set(['preview-1']))).toBeUndefined();
		expect(findNewToolWebPreview([existing, created], new Set(['preview-1']))).toMatchObject({
			previewId: 'preview-2'
		});
	});

	it('hydrates a newer manual edit without replacing a newer tool result', () => {
		const artifact = getWebPreviewsFromOutput([toolOutput('preview-1')])[0] as WebPreviewArtifact;
		expect(
			mergePersistedWebPreview(artifact, {
				title: 'Edited',
				entrypoint: 'index.html',
				files: { 'index.html': { content: '<h1>Edited</h1>', mime: 'text/html' } },
				updated_at: 20
			})
		).toMatchObject({ title: 'Edited', content: '<h1>Edited</h1>', updatedAt: 20 });
	});

	it('keeps an unsaved local draft in the shared artifact state across remounts', () => {
		const artifact = getWebPreviewsFromOutput([toolOutput('preview-1')])[0];
		const files = {
			...artifact.files,
			'index.html': { content: '<h1>Local draft</h1>', mime: 'text/html' }
		};

		expect(
			mergeLocalWebPreviewDraft(artifact, {
				title: 'Edited locally',
				entrypoint: 'index.html',
				files
			})
		).toMatchObject({ title: 'Edited locally', content: '<h1>Local draft</h1>', files });
	});

	it('renders bounded Web Preview read and replace calls as workspace activities', () => {
		const output = buildOutputDisplayItems([
			{
				type: 'function_call',
				call_id: 'read-1',
				name: 'web_preview_read_file',
				status: 'completed'
			},
			{
				type: 'function_call_output',
				call_id: 'read-1',
				output: JSON.stringify({ type: 'web_preview.file_excerpt', previewId: 'preview-1' })
			},
			{
				type: 'function_call',
				call_id: 'replace-1',
				name: 'web_preview_replace_text',
				status: 'completed'
			},
			{ ...toolOutput('preview-1'), call_id: 'replace-1' }
		]);

		expect(output.filter((item) => item.type === 'web_preview_activity')).toMatchObject([
			{ name: 'web_preview_read_file', done: true },
			{ name: 'web_preview_replace_text', done: true, artifact: { previewId: 'preview-1' } }
		]);
	});

	it('renders a runtime data import as a Web Preview update activity', () => {
		const output = buildOutputDisplayItems([
			{
				type: 'function_call',
				call_id: 'import-1',
				name: 'web_preview_import_runtime_file',
				status: 'completed'
			},
			{ ...toolOutput('preview-1'), call_id: 'import-1' }
		]);

		expect(output.filter((item) => item.type === 'web_preview_activity')).toMatchObject([
			{
				name: 'web_preview_import_runtime_file',
				done: true,
				artifact: { previewId: 'preview-1' }
			}
		]);
	});
});
