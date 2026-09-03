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

const seedWorkspaceChat = async (request: APIRequestContext): Promise<SeededWorkspace> => {
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
	const response = await request.post('/api/v1/chats/new', {
		headers: authHeaders(token),
		data: { chat, folder_id: null }
	});
	expect(response.ok()).toBeTruthy();
	const created = await response.json();
	expect(created.id).toEqual(expect.any(String));
	return { chatId: created.id, token };
};

const createUploadChat = async (request: APIRequestContext): Promise<SeededWorkspace> => {
	const token = await signInForNoAuth(request);
	const response = await request.post('/api/v1/chats/new', {
		headers: authHeaders(token),
		data: {
			chat: {
				title: `Workspace upload E2E ${Date.now()}`,
				history: { currentId: null, messages: {} }
			},
			folder_id: null
		}
	});
	expect(response.ok()).toBeTruthy();
	const created = await response.json();
	expect(created.id).toEqual(expect.any(String));
	return { chatId: created.id, token };
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

		await page.getByRole('tab', { name: 'E2E Canvas Alpha', exact: true }).click();
		const canvasTitle = page.locator('#artifacts-container').getByLabel('Title');
		await canvasTitle.fill('E2E Canvas Alpha manual');
		await expect
			.poll(async () => {
				const chat = await readChat(page.request, seeded);
				return chat.chat._canvas_documents[CANVAS_ALPHA].title;
			})
			.toBe('E2E Canvas Alpha manual');

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
		await expect(page.getByLabel('Title')).toHaveValue('E2E Canvas Beta');
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
		await expect(page.getByTestId('workspace-tabs')).toBeVisible();
		await expectSingleArtifactCards(page, {
			canvasAlpha: 'E2E Canvas Alpha manual',
			previewAlpha: 'E2E Preview Alpha manual'
		});
		for (const title of [
			'E2E Canvas Alpha manual',
			'E2E Canvas Beta',
			'E2E Preview Alpha manual',
			'E2E Preview Beta'
		]) {
			await expect(page.getByRole('tab', { name: title, exact: true })).toHaveCount(1);
		}
		await page.getByRole('tab', { name: 'E2E Canvas Alpha manual', exact: true }).click();
		await expect(page.locator('#artifacts-container [contenteditable="true"]')).toContainText(
			'Manual canvas alpha body.'
		);
		await expect(page.getByLabel('Undo AI change')).toHaveCount(0);
		const reloadedChat = await readChat(page.request, seeded);
		expect(reloadedChat.chat._canvas_documents[CANVAS_ALPHA].last_ai_update).toBeNull();
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
