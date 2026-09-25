import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { dismissReleaseNotes } from './ui';

// Run only against a disposable authenticated backend with restricted defaults.
test('restricted user keeps Canvas but cannot upload, promote Notes, or read foreign files', async ({
	page
}) => {
	test.skip(
		process.env.WORKSPACE_E2E_RESTRICTED !== '1',
		'Requires an isolated authenticated backend'
	);
	const request = page.request;
	const signup = await request.post('/api/v1/auths/signup', {
		data: { name: 'Fixture admin', email: `${randomUUID()}@example.com`, password: randomUUID() }
	});
	expect(signup.ok(), 'Start with a fresh test database').toBeTruthy();
	const admin = await signup.json();
	expect(admin.role).toBe('admin');
	const headers = { authorization: `Bearer ${admin.token}` };
	const added = await request.post('/api/v1/auths/add', {
		headers,
		data: {
			name: 'Restricted fixture',
			email: `${randomUUID()}@example.com`,
			password: randomUUID(),
			role: 'user'
		}
	});
	expect(added.ok()).toBeTruthy();
	const restricted = await added.json();
	const userHeaders = { authorization: `Bearer ${restricted.token}` };
	const session = await (await request.get('/api/v1/auths/', { headers: userHeaders })).json();
	expect(session.permissions.chat.file_upload).toBe(false);
	expect(session.permissions.features.code_interpreter).toBe(false);
	expect(session.permissions.features.notes).toBe(false);
	const upload = {
		file: {
			name: 'private.csv',
			mimeType: 'text/csv',
			buffer: Buffer.from('name,value\nPrivate,1\n')
		}
	};
	const privateUpload = await request.post('/api/v1/files/?process=false', {
		headers,
		multipart: upload
	});
	expect(privateUpload.ok()).toBeTruthy();
	const file = await privateUpload.json();
	const forbiddenUpload = await request.post('/api/v1/files/?process=false', {
		headers: userHeaders,
		multipart: upload
	});
	expect.soft(forbiddenUpload.status(), 'Disabled uploads must be rejected by the API').toBe(403);
	for (const endpoint of [`/api/v1/files/${file.id}`, `/api/v1/files/${file.id}/content`]) {
		const response = await request.get(endpoint, { headers: userHeaders });
		expect([403, 404]).toContain(response.status());
	}
	const privateChat = await request.post('/api/v1/chats/new', {
		headers,
		data: { chat: { title: 'Private fixture', history: { currentId: null, messages: {} } } }
	});
	expect(privateChat.ok()).toBeTruthy();
	const privateId = (await privateChat.json()).id;
	const foreignChat = await request.get(`/api/v1/chats/${privateId}`, { headers: userHeaders });
	expect([401, 403, 404]).toContain(foreignChat.status());
	const messageId = randomUUID();
	const created = await request.post('/api/v1/chats/new', {
		headers: userHeaders,
		data: {
			chat: {
				title: 'Restricted Canvas fixture',
				history: {
					currentId: messageId,
					messages: {
						[messageId]: {
							id: messageId,
							role: 'assistant',
							parentId: null,
							childrenIds: [],
							content: 'Permission fixture',
							done: true,
							timestamp: Math.floor(Date.now() / 1000)
						}
					}
				},
				_canvas_documents: {
					document: {
						canvas_id: 'document',
						title: 'Allowed canvas',
						content: '# Allowed canvas\n\nEditable without Notes.',
						updated_at: Date.now()
					}
				},
				_web_preview_documents: {
					preview: {
						preview_id: 'preview',
						title: 'Allowed preview',
						entrypoint: 'index.html',
						files: { 'index.html': { mime: 'text/html', content: '<h1>No runtime needed</h1>' } },
						updated_at: Date.now()
					}
				}
			}
		}
	});
	expect(created.ok()).toBeTruthy();
	const chat = await created.json();
	const current = await (
		await request.get(`/api/v1/chats/${chat.id}`, { headers: userHeaders })
	).json();
	const canvas = current.chat._canvas_documents.document;
	const promote = await request.post(`/api/v1/chats/${chat.id}/canvas/document/promote`, {
		headers: userHeaders,
		data: {
			title: canvas.title,
			content: canvas.content,
			expected_updated_at: canvas.updated_at,
			expected_content_hash: canvas.content_hash
		}
	});
	expect(promote.status()).toBe(403);
	await page.addInitScript((token) => localStorage.setItem('token', token), restricted.token);
	await page.goto(`/c/${chat.id}`);
	await dismissReleaseNotes(page);
	await page.getByRole('button', { name: 'Outputs', exact: true }).last().click();
	await page.getByRole('menu').getByRole('button', { name: 'Allowed canvas', exact: true }).click();
	await expect(
		page.locator('[contenteditable="true"]').filter({ hasText: 'Editable without Notes.' })
	).toBeVisible();
	await expect(page.getByRole('button', { name: /Add to Notes/i })).toHaveCount(0);
	await expect(page.getByRole('tab', { name: 'Files', exact: true })).toHaveCount(0);
	await expect(page.getByRole('link', { name: 'Notes', exact: true })).toHaveCount(0);
	await expect(page.getByRole('menu')).not.toBeVisible();
	await page.getByRole('button', { name: 'Outputs', exact: true }).last().click();
	await page
		.getByRole('menu')
		.getByRole('button', { name: 'Allowed preview', exact: true })
		.click();
	await expect(
		page
			.frameLocator('iframe[title="Allowed preview"]')
			.getByRole('heading', { name: 'No runtime needed' })
	).toBeVisible();
	await expect(page.getByRole('button', { name: /Save to Files|In Files speichern/i })).toHaveCount(
		0
	);
	await expect(page.getByRole('menu')).not.toBeVisible();
	await page.getByRole('button', { name: 'More', exact: true }).last().click();
	const menu = page
		.getByRole('menu')
		.filter({ has: page.getByRole('button', { name: 'Upload Files', exact: true }) });
	await expect(menu).toBeVisible();
	await expect(menu.getByRole('button', { name: 'Upload Files', exact: true })).toBeDisabled();
	await expect(menu.getByRole('button', { name: 'Capture', exact: true })).toBeDisabled();
	await expect(menu.getByRole('button', { name: 'Attach Files', exact: true })).toBeDisabled();
	await expect(menu.getByText('Attach Notes', { exact: true })).toHaveCount(0);
	await expect(menu.getByText('Code Interpreter', { exact: true })).toHaveCount(0);
});
