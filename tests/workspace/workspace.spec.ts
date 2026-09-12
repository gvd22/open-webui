import { createHash } from 'node:crypto';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { dismissReleaseNotes } from './ui';

const CANVAS_ALPHA = 'workspace-e2e-canvas-alpha';
const CANVAS_BETA = 'workspace-e2e-canvas-beta';
const PREVIEW_ALPHA = 'workspace-e2e-preview-alpha';
const PREVIEW_BETA = 'workspace-e2e-preview-beta';

type SeededWorkspace = {
	chatId: string;
	token: string;
	title: string;
};

const textPart = (value: object) => ({
	type: 'function_call_output',
	call_id: crypto.randomUUID(),
	output: [{ type: 'input_text', text: JSON.stringify(value) }]
});

const canvasMarker = (canvasId: string, title: string) =>
	textPart({
		type: 'canvas.document',
		canvasId,
		title,
		updatedAt: 1,
		contentHash: 'seeded-reference'
	});

const previewMarker = (
	previewId: string,
	title: string,
	files: Record<string, { mime: string; content: string }>
) =>
	textPart({
		type: 'web_preview.document',
		previewId,
		title,
		entrypoint: 'index.html',
		updatedAt: 1,
		contentHash: webPreviewContentHash(title, files)
	});

const pendingCanvasApproval = () => ({
	type: 'function_call',
	call_id: crypto.randomUUID(),
	name: 'canvas_update_document',
	arguments: JSON.stringify({
		canvas_id: CANVAS_ALPHA,
		content: '# Stale approval content',
		title: 'E2E Canvas Alpha'
	}),
	status: 'pending'
});

const filesFor = (label: string) => ({
	'index.html': {
		mime: 'text/html',
		content: `<!doctype html><html><head><title>${label}</title></head><body><main><h1>${label}</h1></main></body></html>`
	}
});

const virtualFetchFiles = () => ({
	'index.html': {
		mime: 'text/html',
		content:
			'<!doctype html><html><head><title>E2E Preview Beta</title></head><body><main><h1>E2E preview beta</h1><p id="team">Loading team...</p></main><script>fetch("data.json").then((response) => response.json()).then((data) => { document.querySelector("#team").textContent = data.people.join(", "); });</script></body></html>'
	},
	'data.json': {
		mime: 'application/json',
		content: JSON.stringify({ people: ['Ada Lovelace', 'Grace Hopper'] })
	}
});

const webPreviewContentHash = (
	title: string,
	files: Record<string, { mime: string; content: string }>
) =>
	createHash('sha256')
		.update(
			JSON.stringify({
				entrypoint: 'index.html',
				exported_path: null,
				exported_runtime: null,
				files: Object.fromEntries(
					Object.entries(files)
						.sort(([left], [right]) => left.localeCompare(right))
						.map(([path, file]) => [path, { content: file.content, mime: file.mime }])
				),
				title
			})
		)
		.digest('hex');

const authHeaders = (token: string) => ({ authorization: `Bearer ${token}` });

const signInForNoAuth = async (request: APIRequestContext) => {
	const response = await request.post('/api/v1/auths/signin', {
		data: { email: '', password: '' }
	});
	expect(response.ok()).toBeTruthy();
	const session = await response.json();
	expect(session.token).toEqual(expect.any(String));
	return session.token as string;
};

const seedWorkspaceChat = async (
	request: APIRequestContext,
	changeKind?: 'canvas' | 'web_preview',
	formattedChange?: { before: string; after: string }
): Promise<SeededWorkspace> => {
	const token = await signInForNoAuth(request);
	const timestamp = Date.now();
	const title = `Workspace E2E ${timestamp}`;
	const assistantId = crypto.randomUUID();
	const userId = crypto.randomUUID();
	const alphaFiles = filesFor('E2E preview alpha');
	const betaFiles = virtualFetchFiles();
	const chat = {
		title,
		history: {
			currentId: assistantId,
			messages: {
				[userId]: {
					id: userId,
					parentId: null,
					childrenIds: [assistantId],
					role: 'user',
					content: 'Deterministic workspace lifecycle fixture.',
					timestamp
				},
				[assistantId]: {
					id: assistantId,
					parentId: userId,
					childrenIds: [],
					role: 'assistant',
					content: 'Seeded Canvas and Web Preview documents.',
					done: true,
					timestamp,
					output: [
						canvasMarker(CANVAS_ALPHA, 'E2E Canvas Alpha'),
						canvasMarker(CANVAS_BETA, 'E2E Canvas Beta'),
						previewMarker(PREVIEW_ALPHA, 'E2E Preview Alpha', alphaFiles),
						previewMarker(PREVIEW_BETA, 'E2E Preview Beta', betaFiles),
						pendingCanvasApproval()
					]
				}
			}
		},
		_canvas_documents: {
			[CANVAS_ALPHA]: {
				canvas_id: CANVAS_ALPHA,
				title: 'E2E Canvas Alpha',
				content: '# E2E Canvas Alpha\n\nSeeded canvas alpha body.',
				title_edited: false,
				updated_at: timestamp,
				last_ai_update: null
			},
			[CANVAS_BETA]: {
				canvas_id: CANVAS_BETA,
				title: 'E2E Canvas Beta',
				content: '# E2E Canvas Beta\n\nSeeded canvas beta body.',
				title_edited: false,
				updated_at: timestamp,
				last_ai_update: null
			}
		},
		_web_preview_documents: {
			[PREVIEW_ALPHA]: {
				preview_id: PREVIEW_ALPHA,
				title: 'E2E Preview Alpha',
				entrypoint: 'index.html',
				files: alphaFiles,
				updated_at: timestamp
			},
			[PREVIEW_BETA]: {
				preview_id: PREVIEW_BETA,
				title: 'E2E Preview Beta',
				entrypoint: 'index.html',
				files: betaFiles,
				updated_at: timestamp
			}
		}
	};
	if (changeKind) {
		if (changeKind === 'canvas')
			Object.assign(chat.history.messages[userId], {
				workspace_selection: {
					kind: 'canvas',
					id: CANVAS_ALPHA,
					title: 'E2E Canvas Alpha',
					selection: { text: 'Seeded canvas alpha body.', contentHash: 'a'.repeat(64) }
				}
			});
		const document: any =
			changeKind === 'canvas'
				? chat._canvas_documents[CANVAS_ALPHA]
				: chat._web_preview_documents[PREVIEW_ALPHA];
		if (changeKind === 'canvas' && formattedChange) document.content = formattedChange.before;
		document.last_ai_update =
			changeKind === 'canvas'
				? { title: document.title, content: document.content, title_edited: document.title_edited }
				: { title: document.title, files: document.files, entrypoint: document.entrypoint };
		if (changeKind === 'canvas')
			document.content = formattedChange?.after ?? '# E2E Canvas Alpha\n\nUpdated by AI.';
		else document.files = filesFor('Updated by AI');
		const hash =
			changeKind === 'canvas'
				? createHash('sha256').update(document.content).digest('hex')
				: webPreviewContentHash(document.title, document.files);
		chat.history.messages[assistantId].output!.push(
			textPart({
				type: `${changeKind}.document`,
				canvasId: CANVAS_ALPHA,
				previewId: PREVIEW_ALPHA,
				title: document.title,
				updatedAt: timestamp,
				contentHash: hash,
				changes: [
					{
						path: changeKind === 'canvas' ? 'Canvas' : 'index.html',
						before: 'Before AI',
						after: 'Updated by AI',
						truncated: false
					}
				]
			})
		);
	}
	const response = await request.post('/api/v1/chats/new', {
		headers: authHeaders(token),
		data: { chat, folder_id: null }
	});
	expect(response.ok()).toBeTruthy();
	const created = await response.json();
	expect(created.id).toEqual(expect.any(String));
	return { chatId: created.id, token, title };
};

const createUploadChat = async (request: APIRequestContext): Promise<SeededWorkspace> => {
	const token = await signInForNoAuth(request);
	const title = `Workspace upload E2E ${Date.now()}`;
	const response = await request.post('/api/v1/chats/new', {
		headers: authHeaders(token),
		data: {
			chat: {
				title,
				history: { currentId: null, messages: {} }
			},
			folder_id: null
		}
	});
	expect(response.ok()).toBeTruthy();
	const created = await response.json();
	expect(created.id).toEqual(expect.any(String));
	return { chatId: created.id, token, title };
};

const readChat = async (request: APIRequestContext, seeded: SeededWorkspace) => {
	const response = await request.get(`/api/v1/chats/${seeded.chatId}`, {
		headers: authHeaders(seeded.token)
	});
	expect(response.ok()).toBeTruthy();
	return response.json();
};

const openSeededWorkspace = async (page: Page, seeded: SeededWorkspace) => {
	await page.addInitScript((token) => localStorage.setItem('token', token), seeded.token);
	await page.goto(`/c/${seeded.chatId}`);
	await dismissReleaseNotes(page);
	await expect(page.getByRole('button', { name: 'Outputs', exact: true }).last()).toBeVisible();
	await expect(page.getByTestId('workspace-tabs')).not.toBeVisible();
	await page.getByRole('button', { name: 'Outputs', exact: true }).last().click();
	await page
		.getByRole('menu')
		.getByRole('button', { name: 'E2E Canvas Alpha', exact: true })
		.click();
	await expect(page.getByTestId('workspace-tabs')).toBeVisible();
	for (const title of [
		'E2E Canvas Alpha',
		'E2E Canvas Beta',
		'E2E Preview Alpha',
		'E2E Preview Beta'
	]) {
		await expect(page.getByRole('tab', { name: title, exact: true })).toHaveCount(1);
	}
};

const expectSingleArtifactCards = async (
	page: Page,
	{ canvasAlpha = 'E2E Canvas Alpha', previewAlpha = 'E2E Preview Alpha' } = {}
) => {
	for (const title of [canvasAlpha, 'E2E Canvas Beta']) {
		await expect(page.getByRole('button', { name: `Bearbeiten: ${title}` })).toHaveCount(1);
	}
	for (const title of [previewAlpha, 'E2E Preview Beta']) {
		await expect(page.getByRole('button', { name: `Open: ${title}` })).toHaveCount(1);
	}
};

test.describe('seeded workspace lifecycle', () => {
	let seeded: SeededWorkspace;

	test.beforeEach(async ({ page }) => {
		seeded = await seedWorkspaceChat(page.request);
	});

	test.afterEach(async ({ request }) => {
		if (!seeded) return;
		const response = await request.delete(`/api/v1/chats/${seeded.chatId}`, {
			headers: authHeaders(seeded.token)
		});
		expect(response.ok()).toBeTruthy();
	});

	test('hydrates, autosaves, switches, closes, reopens, and reloads one tab per seeded artifact', async ({
		page
	}) => {
		await openSeededWorkspace(page, seeded);
		await expectSingleArtifactCards(page);
		const tabs = page.getByRole('tab');
		await tabs.first().focus();
		await page.keyboard.press('End');
		await expect(tabs.last()).toBeFocused();
		await page.keyboard.press('Home');
		await expect(tabs.first()).toBeFocused();
		const controlledPanelId = await tabs.first().getAttribute('aria-controls');
		expect(controlledPanelId).toBeTruthy();
		await expect(page.locator(`#${controlledPanelId}`)).toBeVisible();

		await page.getByRole('tab', { name: 'E2E Canvas Alpha', exact: true }).click();
		await expect(page.locator('#artifacts-container').getByLabel('Title')).toHaveCount(0);

		const canvasEditor = page.locator('#artifacts-container [contenteditable="true"]');
		await canvasEditor.click();
		await page.keyboard.press('Meta+A');
		await page.keyboard.type('Manual canvas alpha body.');
		await expect
			.poll(async () => {
				const chat = await readChat(page.request, seeded);
				return chat.chat._canvas_documents[CANVAS_ALPHA].content;
			})
			.toContain('Manual canvas alpha body.');

		await page.getByRole('tab', { name: 'E2E Preview Alpha', exact: true }).click();
		const previewTitle = page.locator('#artifacts-container').getByLabel('Preview title');
		await previewTitle.fill('E2E Preview Alpha manual');
		await expect
			.poll(async () => {
				const chat = await readChat(page.request, seeded);
				return chat.chat._web_preview_documents[PREVIEW_ALPHA].title;
			})
			.toBe('E2E Preview Alpha manual');

		await page.getByRole('button', { name: 'Code', exact: true }).click();
		const previewEditor = page.locator('#artifacts-container .file-code-editor .cm-content');
		await previewEditor.click();
		await page.keyboard.press('Meta+A');
		await page.keyboard.type('<main>E2E preview alpha manual body</main>');
		await expect
			.poll(async () => {
				const chat = await readChat(page.request, seeded);
				return chat.chat._web_preview_documents[PREVIEW_ALPHA].files['index.html'].content;
			})
			.toContain('E2E preview alpha manual body');

		await page.getByRole('tab', { name: 'E2E Canvas Beta', exact: true }).click();
		await expect(page.locator('#artifacts-container [contenteditable="true"]')).toContainText(
			'Seeded canvas beta body.'
		);
		await page.getByRole('tab', { name: 'E2E Preview Beta', exact: true }).click();
		const previewFrame = page.locator('#artifacts-container iframe');
		await expect(previewFrame).toBeVisible();
		await expect(previewFrame).not.toHaveAttribute('sandbox', /allow-same-origin/);
		await expect(page.frameLocator('#artifacts-container iframe').locator('#team')).toHaveText(
			'Ada Lovelace, Grace Hopper'
		);

		await page.getByRole('button', { name: 'Close: E2E Canvas Beta' }).click();
		await expect(page.getByRole('tab', { name: 'E2E Canvas Beta', exact: true })).toHaveCount(0);
		await page.getByRole('button', { name: 'Bearbeiten: E2E Canvas Beta' }).click();
		await expect(page.getByRole('tab', { name: 'E2E Canvas Beta', exact: true })).toHaveCount(1);

		await page.reload();
		await dismissReleaseNotes(page);
		await expect(page.getByRole('button', { name: 'Outputs', exact: true }).last()).toBeVisible();
		await expect(page.getByTestId('workspace-tabs')).not.toBeVisible();
		await page.getByRole('button', { name: 'Outputs', exact: true }).last().click();
		await page
			.getByRole('menu')
			.getByRole('button', { name: 'E2E Canvas Alpha', exact: true })
			.click();
		await expect(page.getByTestId('workspace-tabs')).toBeVisible();
		await expectSingleArtifactCards(page, {
			canvasAlpha: 'E2E Canvas Alpha',
			previewAlpha: 'E2E Preview Alpha manual'
		});
		for (const title of [
			'E2E Canvas Alpha',
			'E2E Canvas Beta',
			'E2E Preview Alpha manual',
			'E2E Preview Beta'
		]) {
			await expect(page.getByRole('tab', { name: title, exact: true })).toHaveCount(1);
		}
		await page.getByRole('tab', { name: 'E2E Canvas Alpha', exact: true }).click();
		await expect(page.locator('#artifacts-container [contenteditable="true"]')).toContainText(
			'Manual canvas alpha body.'
		);
		await expect(page.getByLabel('Undo AI change')).toHaveCount(0);
		const reloadedChat = await readChat(page.request, seeded);
		expect(reloadedChat.chat._canvas_documents[CANVAS_ALPHA].last_ai_update).toBeNull();
	});

	test('reveals the active tab when opened through Outputs in a narrow workspace', async ({
		page
	}) => {
		await page.setViewportSize({ width: 1280, height: 760 });
		await openSeededWorkspace(page, seeded);
		await page.getByRole('button', { name: 'Outputs', exact: true }).last().click();
		await page
			.getByRole('menu')
			.getByRole('button', { name: 'E2E Preview Beta', exact: true })
			.click();
		await expect(page.getByRole('tab', { name: 'E2E Preview Beta', exact: true })).toBeInViewport({
			ratio: 1
		});
	});

	test('keeps the Pyodide workspace free of Terminal and Browser launch controls', async ({
		page
	}) => {
		await openSeededWorkspace(page, seeded);
		const filesTab = page.getByRole('tab', { name: 'Files', exact: true });
		await expect(filesTab).toHaveCount((await filesTab.count()) ? 1 : 0);
		await expect(page.getByRole('button', { name: 'Add to workspace' })).toHaveCount(0);
		await expect(page.getByRole('tab', { name: /^Terminal(?: \d+)?$/ })).toHaveCount(0);
		await expect(page.getByRole('tab', { name: /^Browser(?: \d+)?$/ })).toHaveCount(0);
	});

	for (const kind of ['canvas', 'web-preview'] as const) {
		test(`${kind} retains a conflicted draft across reload and recovers explicitly`, async ({
			page
		}) => {
			await openSeededWorkspace(page, seeded);
			if (kind === 'web-preview')
				await page.getByRole('tab', { name: 'E2E Preview Alpha', exact: true }).click();
			const id = kind === 'canvas' ? CANVAS_ALPHA : PREVIEW_ALPHA;
			const endpoint = `/api/v1/chats/${seeded.chatId}/${kind}/${id}`;
			const remote = await (
				await page.request.post(`${endpoint}/select`, { headers: authHeaders(seeded.token) })
			).json();
			const remoteBody =
				kind === 'canvas'
					? { content: 'Server-only content', title_edited: true }
					: {
							entrypoint: remote.entrypoint,
							files: {
								'index.html': { mime: 'text/html', content: '<h1>Server-only content</h1>' }
							}
						};
			expect(
				(
					await page.request.post(endpoint, {
						headers: authHeaders(seeded.token),
						data: {
							...remoteBody,
							title: remote.title,
							expected_updated_at: remote.updated_at,
							expected_content_hash: remote.contentHash
						}
					})
				).ok()
			).toBeTruthy();
			const titleInput = page.getByLabel(kind === 'canvas' ? 'Title' : 'Preview title', {
				exact: true
			});
			await titleInput.fill('My recovered draft');
			await expect(page.getByRole('region', { name: 'Unsaved draft' })).toBeVisible();
			await expect(titleInput).toHaveValue('My recovered draft');
			await page.getByRole('button', { name: 'Compare', exact: true }).click();
			await expect(page.getByLabel('Changes', { exact: true })).toContainText(
				'Server-only content'
			);
			await page.reload();
			await dismissReleaseNotes(page);
			await page.getByRole('button', { name: 'Outputs', exact: true }).last().click();
			await page.getByRole('menu').getByRole('button', { name: remote.title, exact: true }).click();
			await expect(page.getByRole('region', { name: 'Unsaved draft' })).toBeVisible();
			await expect(titleInput).toHaveValue('My recovered draft');
			await page.getByRole('button', { name: 'Recover draft', exact: true }).click();
			await expect(page.getByRole('region', { name: 'Unsaved draft' })).toHaveCount(0);
			await expect
				.poll(async () => {
					const data = await readChat(page.request, seeded);
					return data.chat[kind === 'canvas' ? '_canvas_documents' : '_web_preview_documents'][id]
						.title;
				})
				.toBe('My recovered draft');
			const latest = await (
				await page.request.post(`${endpoint}/select`, { headers: authHeaders(seeded.token) })
			).json();
			expect(
				(
					await page.request.post(endpoint, {
						headers: authHeaders(seeded.token),
						data: {
							...remoteBody,
							title: 'Server wins on discard',
							expected_updated_at: latest.updated_at,
							expected_content_hash: latest.contentHash
						}
					})
				).ok()
			).toBeTruthy();
			await titleInput.fill('Discard this edit');
			await expect(page.getByRole('region', { name: 'Unsaved draft' })).toBeVisible();
			await page.getByRole('button', { name: 'Discard draft', exact: true }).click();
			await expect(titleInput).toHaveValue('Server wins on discard');
			await expect(page.getByRole('region', { name: 'Unsaved draft' })).toHaveCount(0);
		});
	}

	for (const theme of ['light', 'dark']) {
		test(`multiple artifact activities wrap and open distinct targets in ${theme}`, async ({
			page
		}) => {
			const { chat } = await readChat(page.request, seeded);
			const previous = chat.history.messages[chat.history.currentId];
			const userId = crypto.randomUUID(),
				assistantId = crypto.randomUUID();
			previous.childrenIds = [userId];
			chat.history.messages[userId] = {
				id: userId,
				parentId: previous.id,
				childrenIds: [assistantId],
				role: 'user',
				content: 'Update all four documents.'
			};
			const markers = [
				canvasMarker(CANVAS_ALPHA, 'E2E Canvas Alpha'),
				canvasMarker(CANVAS_BETA, 'E2E Canvas Beta'),
				previewMarker(PREVIEW_ALPHA, 'E2E Preview Alpha', filesFor('E2E preview alpha')),
				previewMarker(PREVIEW_BETA, 'E2E Preview Beta', virtualFetchFiles())
			];
			chat.history.messages[assistantId] = {
				id: assistantId,
				parentId: userId,
				childrenIds: [],
				role: 'assistant',
				content: '',
				done: true,
				output: markers.flatMap((marker, index) => [
					{
						type: 'function_call',
						call_id: marker.call_id,
						name: index < 2 ? 'canvas_update_document' : 'web_preview_update',
						status: 'completed'
					},
					marker
				])
			};
			chat.history.currentId = assistantId;
			const created = await page.request.post('/api/v1/chats/new', {
				headers: authHeaders(seeded.token),
				data: { chat, folder_id: null }
			});
			expect(created.ok()).toBeTruthy();
			const chatId = (await created.json()).id;
			try {
				await page.addInitScript(
					({ token, theme }) => {
						localStorage.setItem('token', token);
						localStorage.setItem('theme', theme);
					},
					{ token: seeded.token, theme }
				);
				await page.goto(`/c/${chatId}`);
				await dismissReleaseNotes(page);
				const activities = page.getByTestId('artifact-activity');
				await expect(activities).toHaveCount(4);
				await activities.first().scrollIntoViewIfNeeded();
				for (const title of [
					'E2E Canvas Alpha',
					'E2E Canvas Beta',
					'E2E Preview Alpha',
					'E2E Preview Beta'
				]) {
					await activities
						.getByRole('button', { name: `Open: ${title} · Updated`, exact: true })
						.click();
					await expect(page.getByRole('tab', { name: title, exact: true })).toHaveAttribute(
						'aria-selected',
						'true'
					);
				}
				await page.getByRole('button', { name: 'Workspace', exact: true }).click();
				await page.screenshot({ path: test.info().outputPath('activities-desktop.png') });
				await page.setViewportSize({ width: 390, height: 844 });
				await activities.first().scrollIntoViewIfNeeded();
				for (const activity of await activities.all()) {
					const bounds = await activity.boundingBox();
					expect(bounds!.x).toBeGreaterThanOrEqual(0);
					expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
				}
				await page.screenshot({ path: test.info().outputPath('activities-narrow.png') });
			} finally {
				await page.request.delete(`/api/v1/chats/${chatId}`, {
					headers: authHeaders(seeded.token)
				});
			}
		});
	}

	for (const structure of [false, true]) {
		test(`preserves Canvas change formatting: ${structure ? 'blocks' : 'inline'}`, async ({
			page
		}) => {
			const changed = await seedWorkspaceChat(
				page.request,
				'canvas',
				structure
					? {
							before:
								'# Original heading\n\n- **Bold item**\n- *Italic item*\n\n```js\nconst old = 1;\n```',
							after:
								'## New heading\n\n1. **New item**\n2. *Other item*\n\n```js\nconst next = 2;\n```'
						}
					: { before: 'Keep **bold old** and *italic*.', after: 'Keep **bold new** and *italic*.' }
			);
			try {
				await openSeededWorkspace(page, changed);
				const original = (await readChat(page.request, changed)).chat._canvas_documents[
					CANVAS_ALPHA
				];
				const workspace = page.locator('#artifacts-container');
				await workspace.getByRole('button', { name: 'Show changes', exact: true }).click();
				const removed = workspace.locator('.canvas-removed-text');
				await expect(removed.locator('strong')).toBeVisible();
				if (structure) {
					await expect(removed.locator('h1')).toHaveText('Original heading');
					await expect(removed.locator('ul li')).toHaveCount(2);
					await expect(removed.locator('em')).toHaveText('Italic item');
					await expect(removed.locator('pre code')).toContainText('const old = 1;');
					await expect(workspace.locator('h2.canvas-added-text')).toHaveText('New heading');
					await expect(workspace.locator('ol.canvas-added-text li')).toHaveCount(2);
				} else {
					await expect(removed.locator('strong')).toHaveText('old');
					await expect(
						workspace.locator('strong .canvas-added-text, .canvas-added-text strong')
					).toContainText('new');
				}
				await page.screenshot({ path: test.info().outputPath('formatted-changes.png') });
				await workspace.getByRole('button', { name: 'Hide changes', exact: true }).click();
				await expect(removed).toHaveCount(0);
				expect(
					(await readChat(page.request, changed)).chat._canvas_documents[CANVAS_ALPHA]
				).toEqual(original);
			} finally {
				await page.request.delete(`/api/v1/chats/${changed.chatId}`, {
					headers: authHeaders(changed.token)
				});
			}
		});
	}

	for (const kind of ['canvas', 'web_preview'] as const) {
		test(`shows changes only inside Canvas, never in chat or ${kind} preview`, async ({ page }) => {
			const changed = await seedWorkspaceChat(page.request, kind);
			try {
				await page.addInitScript(
					(theme) => localStorage.setItem('theme', theme),
					kind === 'canvas' ? 'light' : 'dark'
				);
				await openSeededWorkspace(page, changed);
				await page.getByRole('tab', { name: 'E2E Canvas Beta', exact: true }).click();
				await page.reload();
				await dismissReleaseNotes(page);
				if (kind === 'canvas')
					await expect(page.getByLabel('Selected passage', { exact: true })).toContainText(
						'Seeded canvas alpha body.'
					);
				await expect(page.getByRole('region', { name: 'Artifact changes' })).toHaveCount(0);
				const reopen = async (title: string) => {
					await page.getByRole('button', { name: 'Outputs', exact: true }).last().click();
					await page.getByRole('menu').getByRole('button', { name: title, exact: true }).click();
				};
				await reopen('E2E Preview Alpha');
				await expect(page.getByRole('button', { name: 'Show changes', exact: true })).toHaveCount(
					0
				);
				if (kind === 'web_preview') return;
				await reopen('E2E Canvas Alpha');
				const workspace = page.locator('#artifacts-container');
				const original = (await readChat(page.request, changed)).chat._canvas_documents[
					CANVAS_ALPHA
				];
				const showChanges = workspace.getByRole('button', { name: 'Show changes', exact: true });
				const togglePosition = await showChanges.boundingBox();
				await showChanges.click();
				const hideChanges = workspace.getByRole('button', { name: 'Hide changes', exact: true });
				await expect(hideChanges).toBeVisible();
				expect(await hideChanges.boundingBox()).toEqual(togglePosition);
				const undoPosition = await workspace
					.getByRole('button', { name: 'Undo AI change', exact: true })
					.boundingBox();
				expect(undoPosition!.x + undoPosition!.width).toBeLessThanOrEqual(togglePosition!.x);
				await expect(workspace.locator('.ProseMirror .canvas-removed-text')).toContainText(
					'Seeded canvas alpha body'
				);
				await expect(workspace.locator('.ProseMirror .canvas-added-text')).toContainText(
					'Updated by AI'
				);
				await expect(workspace.getByRole('heading', { name: 'E2E Canvas Alpha' })).toBeVisible();
				await page.screenshot({ path: test.info().outputPath('canvas-document-changes.png') });
				await workspace.getByRole('button', { name: 'Hide changes', exact: true }).click();
				await expect(workspace.locator('.canvas-removed-text')).toHaveCount(0);
				expect(await showChanges.boundingBox()).toEqual(togglePosition);
				expect(
					(await readChat(page.request, changed)).chat._canvas_documents[CANVAS_ALPHA]
				).toEqual(original);
				await page.reload();
				await dismissReleaseNotes(page);
				await reopen('E2E Canvas Alpha');
				await workspace.getByRole('button', { name: 'Show changes', exact: true }).click();
				await workspace.getByRole('button', { name: 'Undo AI change', exact: true }).click();
				const data = await readChat(page.request, changed);
				const doc =
					kind === 'canvas'
						? data.chat._canvas_documents[CANVAS_ALPHA]
						: data.chat._web_preview_documents[PREVIEW_ALPHA];
				expect(doc.last_ai_update).toBeNull();
				expect(JSON.stringify(doc)).not.toContain('Updated by AI');
				await page.reload();
				await dismissReleaseNotes(page);
				await reopen('E2E Canvas Alpha');
				await expect(
					workspace.getByRole('button', { name: 'Show changes', exact: true })
				).toHaveCount(0);
			} finally {
				await page.request.delete(`/api/v1/chats/${changed.chatId}`, {
					headers: authHeaders(changed.token)
				});
			}
		});
	}

	test('clears Canvas highlights on manual edit without saving removed text', async ({ page }) => {
		const changed = await seedWorkspaceChat(page.request, 'canvas');
		try {
			await page.addInitScript(() => localStorage.setItem('theme', 'dark'));
			await openSeededWorkspace(page, changed);
			await page.setViewportSize({ width: 390, height: 844 });
			const workspace = page.locator('#artifacts-container');
			await workspace.getByRole('button', { name: 'Show changes', exact: true }).click();
			await expect(workspace.locator('.canvas-removed-text')).toBeVisible();
			await page.screenshot({
				path: test.info().outputPath('canvas-document-changes-mobile-dark.png')
			});
			await workspace.locator('[contenteditable="true"]').click();
			await page.keyboard.press('Meta+End');
			await page.keyboard.type(' Manual edit.');
			await expect(workspace.locator('.canvas-removed-text')).toHaveCount(0);
			await expect
				.poll(
					async () =>
						(await readChat(page.request, changed)).chat._canvas_documents[CANVAS_ALPHA].content
				)
				.toContain('Manual edit.');
			const saved = (await readChat(page.request, changed)).chat._canvas_documents[CANVAS_ALPHA];
			expect(saved.content).not.toContain('Seeded canvas alpha body');
			expect(saved.content).not.toContain('canvas-added-text');
			expect(saved.last_ai_update).toBeNull();
		} finally {
			await page.request.delete(`/api/v1/chats/${changed.chatId}`, {
				headers: authHeaders(changed.token)
			});
		}
	});

	test('starts Canvas at the document with floating actions and no header', async ({ page }) => {
		const endpoint = `/api/v1/chats/${seeded.chatId}/canvas/${CANVAS_ALPHA}`;
		const version = await (
			await page.request.post(`${endpoint}/select`, {
				headers: authHeaders(seeded.token)
			})
		).json();
		const response = await page.request.post(endpoint, {
			headers: authHeaders(seeded.token),
			data: {
				title: version.title,
				content: '# A different document heading\n\nThe body stays editable.',
				expected_updated_at: version.updated_at,
				expected_content_hash: version.contentHash
			}
		});
		expect(response.ok()).toBe(true);
		await openSeededWorkspace(page, seeded);
		await expect(page.getByTestId('canvas-header')).toHaveCount(0);
		await expect(page.locator('#artifacts-container').getByLabel('Title')).toHaveCount(0);
		const actions = page.getByTestId('canvas-actions');
		await expect(actions).toHaveCSS('position', 'absolute');
		await expect(page.locator('#artifacts-container')).not.toContainText(/\d+ (words|characters)/);
		expect((await readChat(page.request, seeded)).chat._canvas_documents[CANVAS_ALPHA].title).toBe(
			version.title
		);
		const heading = page.locator('#artifacts-container [contenteditable="true"] h1');
		await expect(heading).toHaveText('A different document heading');
		await page.screenshot({ path: test.info().outputPath('canvas-header-desktop.png') });
		await page.setViewportSize({ width: 390, height: 844 });
		const bounds = await actions.boundingBox();
		expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
		const panel = await page
			.getByRole('tabpanel', { name: 'E2E Canvas Alpha', exact: true })
			.boundingBox();
		const text = await heading.boundingBox();
		expect(text!.y - panel!.y).toBeLessThan(32);
		const textRects = await heading.evaluate((element) => {
			const range = document.createRange();
			range.selectNodeContents(element);
			return [...range.getClientRects()].map(({ x, y, width, height }) => ({
				x,
				y,
				width,
				height
			}));
		});
		for (const rect of textRects) {
			expect(
				rect.x + rect.width <= bounds!.x ||
					rect.y >= bounds!.y + bounds!.height ||
					rect.y + rect.height <= bounds!.y
			).toBe(true);
		}
		await page.screenshot({ path: test.info().outputPath('canvas-header-narrow.png') });
	});

	test('selects formatted text without rewriting Markdown or creating an autosave', async ({
		page
	}) => {
		const endpoint = `/api/v1/chats/${seeded.chatId}/canvas/${CANVAS_ALPHA}`;
		const version = await (
			await page.request.post(`${endpoint}/select`, { headers: authHeaders(seeded.token) })
		).json();
		const source =
			'# E2E Canvas Alpha\n\nA **bold** sentence with [a link](https://example.com).\n\nKeep the second paragraph unchanged.';
		const updated = await page.request.post(endpoint, {
			headers: authHeaders(seeded.token),
			data: {
				content: source,
				title: version.title,
				expected_updated_at: version.updated_at,
				expected_content_hash: version.contentHash
			}
		});
		expect(updated.ok()).toBe(true);
		await openSeededWorkspace(page, seeded);
		const original = (await readChat(page.request, seeded)).chat._canvas_documents[CANVAS_ALPHA];
		await page
			.locator('#artifacts-container [contenteditable="true"] p')
			.first()
			.click({ clickCount: 3 });
		await page.getByLabel('Selection instruction').fill('Make it clearer.');
		await page.getByRole('button', { name: 'Add to chat', exact: true }).click();
		await expect(page.getByRole('button', { name: 'Remove selection' })).toBeVisible();
		await expect(page.getByLabel('Selected passage', { exact: true })).toContainText(
			'A bold sentence with a link.'
		);
		expect((await readChat(page.request, seeded)).chat._canvas_documents[CANVAS_ALPHA]).toEqual(
			original
		);
		let focus: any;
		await page.route('**/api/chat/completions', async (route) => {
			focus = route.request().postDataJSON().workspace_focus;
			await route.fulfill({
				status: 200,
				contentType: 'text/event-stream',
				body: 'data: [DONE]\n\n'
			});
		});
		await page.locator('#send-message-button').click();
		await expect
			.poll(() => focus?.selection?.text)
			.toBe('A **bold** sentence with [a link](https://example.com).');
		expect(focus.selection.contentHash).toBe(original.content_hash);
	});

	test('flushes immediate edits before adding the selection and rejects real concurrent changes', async ({
		page
	}) => {
		await openSeededWorkspace(page, seeded);
		const editor = page.locator('#artifacts-container [contenteditable="true"]');
		await editor.fill('A freshly pasted sentence.');
		await editor.press('ControlOrMeta+A');
		await page.getByRole('button', { name: 'Add to chat', exact: true }).click();
		await expect(page.getByRole('button', { name: 'Remove selection' })).toBeVisible();
		await expect(page.getByLabel('Selected passage', { exact: true })).toContainText(
			'A freshly pasted sentence.'
		);
		const saved = (await readChat(page.request, seeded)).chat._canvas_documents[CANVAS_ALPHA];
		expect(saved.content).toBe('# A freshly pasted sentence.');
		await page.getByRole('button', { name: 'Remove selection' }).click();
		await editor.click();
		await editor.press('ControlOrMeta+A');
		await page.getByLabel('Selection instruction').fill('Shorten it.');
		const endpoint = `/api/v1/chats/${seeded.chatId}/canvas/${CANVAS_ALPHA}`;
		const version = await (
			await page.request.post(`${endpoint}/select`, { headers: authHeaders(seeded.token) })
		).json();
		const concurrentUpdate = await page.request.post(endpoint, {
			headers: authHeaders(seeded.token),
			data: {
				title: version.title,
				content: saved.content + '\n\nChanged elsewhere.',
				expected_updated_at: version.updated_at,
				expected_content_hash: version.contentHash
			}
		});
		expect(concurrentUpdate.ok()).toBe(true);
		await page.getByRole('button', { name: 'Add to chat', exact: true }).click();
		await expect(
			page.getByText(
				'The document changed while preparing this selection. Please select the passage again.',
				{ exact: true }
			)
		).toBeVisible();
		await expect(page.getByRole('button', { name: 'Remove selection' })).toHaveCount(0);
	});

	test('captures a versioned Canvas selection even after switching tabs', async ({ page }) => {
		await openSeededWorkspace(page, seeded);
		const editor = page.locator('#artifacts-container [contenteditable="true"]');
		await editor.locator('p').first().click({ clickCount: 3 });
		await page.getByLabel('Selection instruction').fill('Make this passage clearer.');
		await page.getByRole('button', { name: 'Add to chat', exact: true }).click();
		await expect(page.locator('#chat-input')).toContainText('Make this passage clearer.');
		await expect(page.getByRole('button', { name: 'Remove selection' })).toBeVisible();
		await page.getByRole('tab', { name: 'E2E Canvas Beta', exact: true }).click();
		let focus: any;
		let sentMessage: any;
		await page.route('**/api/chat/completions', async (route) => {
			focus = route.request().postDataJSON().workspace_focus;
			sentMessage = route.request().postDataJSON().user_message;
			await route.fulfill({
				status: 200,
				contentType: 'text/event-stream',
				body: 'data: [DONE]\n\n'
			});
		});
		await page.locator('#send-message-button').click();
		await expect.poll(() => focus?.id).toBe(CANVAS_ALPHA);
		expect(focus.selection.text).toContain('Seeded canvas alpha body.');
		expect(focus.selection.contentHash).toMatch(/^[a-f0-9]{64}$/);
		expect(sentMessage.workspace_selection.selection).toEqual(focus.selection);
		await expect(page.getByLabel('Selected passage', { exact: true })).toContainText(
			'Seeded canvas alpha body.'
		);
	});

	test('shows bounded preview errors, prepares a fix request and supports narrow code layouts', async ({
		page
	}) => {
		await openSeededWorkspace(page, seeded);
		await page.getByRole('tab', { name: 'E2E Preview Alpha', exact: true }).click();
		await expect(page.getByRole('button', { name: 'Mobile', exact: true })).toHaveCount(0);
		await expect(page.getByRole('button', { name: 'Desktop', exact: true })).toHaveCount(0);
		await page.getByRole('button', { name: 'Code', exact: true }).click();
		const editor = page.locator('#artifacts-container .cm-content');
		await editor.click();
		await page.keyboard.press('Meta+A');
		await page.keyboard.type(
			'<h1>Diagnostics</h1><script>fetch("missing.json"); throw new Error("Deliberate preview error");</script>'
		);
		await page.getByRole('button', { name: 'Preview', exact: true }).click();
		await page.getByRole('button', { name: /^Errors/ }).click();
		await expect(page.getByRole('region', { name: 'Preview errors' })).toContainText(
			'Deliberate preview error'
		);
		await expect(page.getByRole('region', { name: 'Preview errors' })).toContainText(
			'missing.json'
		);
		await expect(page.locator('#artifacts-container iframe')).not.toHaveAttribute(
			'sandbox',
			/allow-same-origin/
		);
		await page.getByRole('button', { name: 'Ask AI to fix' }).click();
		await expect(page.locator('#chat-input')).toContainText('untrusted runtime evidence');
		await page.setViewportSize({ width: 390, height: 844 });
		await page.getByRole('button', { name: 'Code', exact: true }).click();
		await expect(page.getByLabel('Preview file', { exact: true })).toBeVisible();
		await expect(page.getByRole('navigation', { name: 'Preview files' })).not.toBeVisible();
	});

	test('adds a quote without replacing a draft and returns to chat on narrow screens', async ({
		page
	}) => {
		await openSeededWorkspace(page, seeded);
		await page.locator('#chat-input').fill('Keep my existing instruction.');
		await page.setViewportSize({ width: 390, height: 844 });
		await page
			.locator('#artifacts-container [contenteditable="true"] p')
			.first()
			.click({ clickCount: 3 });
		const selection = page.getByLabel('Edit selected passage', { exact: true });
		await expect(selection).toBeVisible();
		const box = await selection.boundingBox();
		expect(box!.x).toBeGreaterThanOrEqual(0);
		expect(box!.x + box!.width).toBeLessThanOrEqual(390);
		await page.screenshot({ path: test.info().outputPath('selection-mobile.png') });
		await page.getByRole('button', { name: 'Add to chat', exact: true }).click();
		await expect(page.getByTestId('workspace-tabs')).not.toBeVisible();
		await expect(page.locator('#chat-input')).toHaveText('Keep my existing instruction.');
		await expect(page.getByLabel('Selected passage', { exact: true })).toContainText(
			'Seeded canvas alpha body.'
		);
		await page.screenshot({ path: test.info().outputPath('selection-chat-quote.png') });
		await page.getByRole('button', { name: 'Remove selection' }).click();
		await expect(page.getByLabel('Selected passage', { exact: true })).toHaveCount(0);
		await expect(page.locator('#chat-input')).toHaveText('Keep my existing instruction.');
	});

	test('saves an edit to its original chat during an immediate chat switch', async ({ page }) => {
		const otherChat = await seedWorkspaceChat(page.request);
		try {
			await openSeededWorkspace(page, seeded);
			await page.getByRole('tab', { name: 'E2E Canvas Alpha', exact: true }).click();
			await page
				.locator('#artifacts-container [contenteditable="true"]')
				.fill('Only chat A changed');

			await page.getByRole('button', { name: 'Open Sidebar', exact: true }).click();
			await page.getByText(otherChat.title, { exact: true }).click();
			await page.waitForURL(`/c/${otherChat.chatId}`);
			await dismissReleaseNotes(page);

			await expect
				.poll(async () => {
					const chat = await readChat(page.request, seeded);
					return chat.chat._canvas_documents[CANVAS_ALPHA].content;
				})
				.toContain('Only chat A changed');
			const untouched = await readChat(page.request, otherChat);
			expect(untouched.chat._canvas_documents[CANVAS_ALPHA].title).toBe('E2E Canvas Alpha');
		} finally {
			await page.request.delete(`/api/v1/chats/${otherChat.chatId}`, {
				headers: authHeaders(otherChat.token)
			});
		}
	});
});

test('uploads a CSV through the visible composer chooser without a managed Terminal', async ({
	page
}) => {
	const uploadChat = await createUploadChat(page.request);
	let uploadedFileId: string | null = null;
	const name = `workspace-e2e-upload-${Date.now()}.csv`;

	try {
		await page.addInitScript((token) => localStorage.setItem('token', token), uploadChat.token);
		await page.goto(`/c/${uploadChat.chatId}`);
		await dismissReleaseNotes(page);
		const moreButton = page.locator('#input-menu-button');
		await expect(moreButton).toBeVisible();
		await moreButton.click();
		const uploadButton = page.getByRole('button', { name: 'Upload Files', exact: true });
		await expect(uploadButton).toBeVisible();

		const chooserPromise = page.waitForEvent('filechooser');
		await uploadButton.click();
		const chooser = await chooserPromise;
		const uploadResponse = page.waitForResponse(
			(response) =>
				response.request().method() === 'POST' &&
				new URL(response.url()).pathname === '/api/v1/files/',
			{ timeout: 20_000 }
		);
		await chooser.setFiles({
			name,
			mimeType: 'text/csv',
			buffer: Buffer.from('city,value\nBasel,1\nBern,2\n')
		});

		const response = await uploadResponse;
		expect(response.ok()).toBeTruthy();
		uploadedFileId = (await response.json()).id ?? null;
		expect(uploadedFileId).toEqual(expect.any(String));
		await expect(page.getByRole('button', { name: new RegExp(name) })).toBeVisible({
			timeout: 20_000
		});
	} finally {
		if (uploadedFileId) {
			await page.request.delete(`/api/v1/files/${uploadedFileId}`, {
				headers: authHeaders(uploadChat.token)
			});
		}
		await page.request.delete(`/api/v1/chats/${uploadChat.chatId}`, {
			headers: authHeaders(uploadChat.token)
		});
	}
});

test('opens and reopens Files in a new session without a page reload', async ({ page }) => {
	const token = await signInForNoAuth(page.request);
	await page.addInitScript((value) => localStorage.setItem('token', value), token);
	await page.goto('/');
	await dismissReleaseNotes(page);
	await page.evaluate(() => ((window as any).__workspacePageSentinel = crypto.randomUUID()));
	const sentinel = await page.evaluate(() => (window as any).__workspacePageSentinel);

	await page.getByRole('button', { name: 'Workspace', exact: true }).click();
	await expect(page.getByRole('tab', { name: 'Files', exact: true })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Close: Files', exact: true })).toHaveCount(0);
	await expect
		.poll(() => page.evaluate(() => (window as any).__workspacePageSentinel))
		.toBe(sentinel);

	await page
		.getByTestId('workspace-tabs')
		.getByRole('button', { name: 'Close', exact: true })
		.click();
	await expect(page.getByTestId('workspace-tabs')).toHaveCount(0);
	await page.getByRole('button', { name: 'Workspace', exact: true }).click();
	await expect(page.getByRole('tab', { name: 'Files', exact: true })).toBeVisible();
	await expect
		.poll(() => page.evaluate(() => (window as any).__workspacePageSentinel))
		.toBe(sentinel);
});

test('reopens a durable output card after its Pyodide file is no longer catalogued', async ({
	page,
	browser
}) => {
	const token = await signInForNoAuth(page.request);
	const name = `durable-output-${Date.now()}.csv`;
	const workspacePath = `/mnt/uploads/${name}`;
	let chatId: string | null = null;
	let fileId: string | null = null;

	try {
		const upload = await page.request.post('/api/v1/files/', {
			headers: authHeaders(token),
			multipart: {
				file: {
					name,
					mimeType: 'text/csv',
					buffer: Buffer.from('x\n1\n')
				}
			}
		});
		expect(upload.ok()).toBeTruthy();
		fileId = (await upload.json()).id;

		const userId = crypto.randomUUID();
		const assistantId = crypto.randomUUID();
		const created = await page.request.post('/api/v1/chats/new', {
			headers: authHeaders(token),
			data: {
				chat: {
					title: `Durable output E2E ${Date.now()}`,
					history: {
						currentId: assistantId,
						messages: {
							[userId]: {
								id: userId,
								parentId: null,
								childrenIds: [assistantId],
								role: 'user',
								content: 'Create a CSV.',
								timestamp: Date.now()
							},
							[assistantId]: {
								id: assistantId,
								parentId: userId,
								childrenIds: [],
								role: 'assistant',
								content: 'Created the requested CSV.',
								done: true,
								timestamp: Date.now(),
								files: [
									{
										type: 'file',
										id: fileId,
										url: fileId,
										name,
										content_type: 'text/csv',
										size: 4,
										status: 'uploaded',
										source: 'workspace-output',
										workspace_path: workspacePath
									}
								]
							}
						}
					},
					_workspace_outputs: []
				},
				folder_id: null
			}
		});
		expect(created.ok()).toBeTruthy();
		chatId = (await created.json()).id;

		await page.addInitScript((value) => localStorage.setItem('token', value), token);
		await page.goto(`/c/${chatId}`);
		await dismissReleaseNotes(page);
		await page.getByRole('button', { name: `Open: ${name}`, exact: true }).click();

		await expect(page.getByRole('tab', { name, exact: true })).toBeVisible();
		await expect(page.getByRole('tabpanel', { name })).toContainText('x');
		const url = page.url();
		await page.close();
		const reopened = await browser.newPage();
		try {
			await reopened.addInitScript((value) => localStorage.setItem('token', value), token);
			await reopened.goto(url);
			await dismissReleaseNotes(reopened);
			await reopened.getByRole('button', { name: `Open: ${name}`, exact: true }).click();
			await expect(reopened.getByRole('tabpanel', { name })).toContainText('x');
		} finally {
			await reopened.close();
		}
	} finally {
		if (chatId) {
			await page.request.delete(`/api/v1/chats/${chatId}`, { headers: authHeaders(token) });
		}
		if (fileId) {
			await page.request.delete(`/api/v1/files/${fileId}`, { headers: authHeaders(token) });
		}
	}
});
