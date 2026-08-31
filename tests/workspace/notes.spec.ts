import { expect, test, type APIRequestContext } from '@playwright/test';

const CANVAS_ID = `notes-e2e-${Date.now()}`;
const NOTE_BODY =
	'# Launch Checklist\n- [ ] Confirm launch assets\n- [ ] Test key workflows\n- [ ] Send launch announcement\n\nOwner: Alex';

type Fixture = {
	chatId: string;
	noteId: string;
	token: string;
};

const authHeaders = (token: string) => ({ authorization: `Bearer ${token}` });

const waitForHealth = async (request: APIRequestContext) => {
	await expect
		.poll(
			async () => {
				try {
					return (await request.get('/api/config')).status();
				} catch {
					return 0;
				}
			},
			{ timeout: 30_000, intervals: [250, 500, 1000] }
		)
		.toBe(200);
};

const signInForNoAuth = async (request: APIRequestContext) => {
	const response = await request.post('/api/v1/auths/signin', {
		data: { email: '', password: '' }
	});
	expect(response.ok()).toBeTruthy();
	const session = await response.json();
	expect(session.token).toEqual(expect.any(String));
	return session.token as string;
};

const createPromotedNoteFixture = async (request: APIRequestContext): Promise<Fixture> => {
	const token = await signInForNoAuth(request);
	const timestamp = Date.now();
	const userMessageId = crypto.randomUUID();
	const assistantMessageId = crypto.randomUUID();
	let chatId: string | null = null;
	let noteId: string | null = null;
	try {
		const chatResponse = await request.post('/api/v1/chats/new', {
			headers: authHeaders(token),
			data: {
				chat: {
					title: `Notes E2E ${timestamp}`,
					history: {
						currentId: assistantMessageId,
						messages: {
							[userMessageId]: {
								id: userMessageId,
								parentId: null,
								childrenIds: [assistantMessageId],
								role: 'user',
								content: 'Create a launch checklist note.',
								timestamp
							},
							[assistantMessageId]: {
								id: assistantMessageId,
								parentId: userMessageId,
								childrenIds: [],
								role: 'assistant',
								content: 'Launch checklist fixture.',
								done: true,
								timestamp
							}
						}
					},
					_canvas_documents: {
						[CANVAS_ID]: {
							canvas_id: CANVAS_ID,
							title: 'Launch Checklist',
							content: NOTE_BODY,
							title_edited: false,
							updated_at: timestamp,
							last_ai_update: null
						}
					}
				},
				folder_id: null
			}
		});
		expect(chatResponse.ok()).toBeTruthy();
		const chat = await chatResponse.json();
		expect(chat.id).toEqual(expect.any(String));
		chatId = chat.id as string;
		const currentChatResponse = await request.get(`/api/v1/chats/${chatId}`, {
			headers: authHeaders(token)
		});
		expect(currentChatResponse.ok()).toBeTruthy();
		const currentChat = await currentChatResponse.json();
		const currentCanvas = currentChat.chat._canvas_documents[CANVAS_ID];
		expect(currentCanvas).toMatchObject({
			updated_at: expect.any(Number),
			content_hash: expect.any(String)
		});

		const promotionResponse = await request.post(
			`/api/v1/chats/${chat.id}/canvas/${CANVAS_ID}/promote`,
			{
				headers: authHeaders(token),
				data: {
					title: 'Launch Checklist',
					content: NOTE_BODY,
					expected_updated_at: currentCanvas.updated_at,
					expected_content_hash: currentCanvas.content_hash
				}
			}
		);
		if (!promotionResponse.ok()) {
			throw new Error(
				`Canvas promotion failed (${promotionResponse.status()}): ${await promotionResponse.text()}`
			);
		}
		const note = await promotionResponse.json();
		expect(note.id).toEqual(expect.any(String));
		noteId = note.id as string;
		expect(note.data.content).toEqual({ md: NOTE_BODY, html: '', json: null });

		return { chatId: chatId as string, noteId: noteId as string, token };
	} catch (error) {
		if (noteId) {
			await request.delete(`/api/v1/notes/${noteId}/delete`, {
				headers: authHeaders(token)
			});
		}
		if (chatId) {
			await request.delete(`/api/v1/chats/${chatId}`, {
				headers: authHeaders(token)
			});
		}
		throw error;
	}
};

const readNote = async (request: APIRequestContext, fixture: Fixture) => {
	const response = await request.get(`/api/v1/notes/${fixture.noteId}`, {
		headers: authHeaders(fixture.token)
	});
	expect(response.ok()).toBeTruthy();
	return response.json();
};

const readChat = async (request: APIRequestContext, fixture: Fixture) => {
	const response = await request.get(`/api/v1/chats/${fixture.chatId}`, {
		headers: authHeaders(fixture.token)
	});
	expect(response.ok()).toBeTruthy();
	return response.json();
};

const deleteFixture = async (request: APIRequestContext, fixture: Fixture) => {
	const noteResponse = await request.delete(`/api/v1/notes/${fixture.noteId}/delete`, {
		headers: authHeaders(fixture.token)
	});
	expect(noteResponse.ok()).toBeTruthy();
	const chatResponse = await request.delete(`/api/v1/chats/${fixture.chatId}`, {
		headers: authHeaders(fixture.token)
	});
	expect(chatResponse.ok()).toBeTruthy();
};

type WebSocketFrame = { payload: string | Buffer };

const noteContentFromSocketFrame = (frame: WebSocketFrame) => {
	const frameText = typeof frame.payload === 'string' ? frame.payload : frame.payload.toString();
	const jsonStart = frameText.indexOf('[');
	if (jsonStart === -1) return null;

	try {
		const packet = JSON.parse(frameText.slice(jsonStart));
		if (packet?.[0] !== 'ydoc:document:update') return null;
		return packet[1]?.data?.content ?? null;
	} catch {
		return null;
	}
};

test.describe('promoted note editor lifecycle', () => {
	let fixture: Fixture;

	test.beforeEach(async ({ request }) => {
		await waitForHealth(request);
		fixture = await createPromotedNoteFixture(request);
	});

	test.afterEach(async ({ request }) => {
		if (fixture) await deleteFixture(request, fixture);
	});

	test('loads Markdown promotion without emitting a blank snapshot on open or reload', async ({
		page
	}) => {
		const blankSnapshots: unknown[] = [];
		const documentUpdates: unknown[] = [];
		page.on('websocket', (webSocket) => {
			webSocket.on('framesent', (frame) => {
				const content = noteContentFromSocketFrame(frame);
				if (!content) return;
				documentUpdates.push(content);
				if (content.md === '') blankSnapshots.push(content);
			});
		});

		await page.addInitScript((token) => localStorage.setItem('token', token), fixture.token);
		await page.goto(`/notes/${fixture.noteId}`);

		const editor = page.locator('#note-content-container [contenteditable="true"]');
		await expect(editor).toContainText('Confirm launch assets');
		await expect(editor).toContainText('Owner: Alex');
		const wordCount = page
			.locator('#note-editor')
			.getByText(/\d+ words/)
			.first();
		await expect(wordCount).toBeVisible();
		await expect(wordCount).not.toHaveText('0 words');
		await page.waitForTimeout(1200);

		await page.reload();
		await expect(editor).toContainText('Confirm launch assets');
		await expect(editor).toContainText('Owner: Alex');
		await expect(wordCount).not.toHaveText('0 words');
		await page.waitForTimeout(1200);

		expect(documentUpdates.length).toBeGreaterThan(0);
		expect(blankSnapshots).toEqual([]);
		const persistedNote = await readNote(page.request, fixture);
		expect(persistedNote.data.content.md).toContain('Launch Checklist');
		for (const item of [
			'Confirm launch assets',
			'Test key workflows',
			'Send launch announcement'
		]) {
			expect(persistedNote.data.content.md).toContain(item);
		}
		expect(persistedNote.data.content.md).toContain('Owner: Alex');
		expect(persistedNote.data.content.md).not.toBe('');
		const persistedCanvasContent = (await readChat(page.request, fixture)).chat._canvas_documents[
			CANVAS_ID
		].content;
		expect(persistedCanvasContent).not.toBe('');
		for (const item of [
			'Launch Checklist',
			'Confirm launch assets',
			'Test key workflows',
			'Send launch announcement',
			'Owner: Alex'
		]) {
			expect(persistedCanvasContent).toContain(item);
		}
	});
});
