import { expect, test, type APIRequestContext } from '@playwright/test';
import { dismissReleaseNotes } from './ui';

const API_BASE_URL = process.env.OPEN_WEBUI_RUNTIME_API_BASE_URL ?? 'http://127.0.0.1:8081';
const TERMINAL_ID = 'workspace-dev-v0111';
const TEST_DIRECTORY = `.codex-runtime-api-${crypto.randomUUID()}`;
const PORT = 8765;

type TestChat = {
	id: string;
	label: string;
};

const authorizationHeaders = (token: string) => ({ authorization: `Bearer ${token}` });

const terminalPath = (chatId: string, path: string) =>
	`/api/v1/terminals/${TERMINAL_ID}/chat/${chatId}/${path}`;

const requestWithChatHeader = (token: string, chatId: string) => ({
	...authorizationHeaders(token),
	'X-Session-Id': chatId
});

const createChat = async (
	request: APIRequestContext,
	token: string,
	label: string
): Promise<TestChat> => {
	const messageId = crypto.randomUUID();
	const response = await request.post('/api/v1/chats/new', {
		headers: authorizationHeaders(token),
		data: {
			chat: {
				title: `Runtime API diagnostic ${label} ${Date.now()}`,
				history: {
					currentId: messageId,
					messages: {
						[messageId]: {
							id: messageId,
							role: 'assistant',
							content: 'Runtime browser test fixture.',
							parentId: null,
							childrenIds: [],
							done: true
						}
					}
				}
			},
			folder_id: null
		}
	});
	expect(response.ok()).toBeTruthy();
	const chat = await response.json();
	expect(chat.id).toEqual(expect.any(String));
	return { id: chat.id, label };
};

const outputContains = (result: unknown, value: string) => JSON.stringify(result).includes(value);

test.describe('workspace Terminal diagnostics and Browser regression', () => {
	test.describe.configure({ mode: 'serial' });

	let request: APIRequestContext;
	let token = '';
	let chats: TestChat[] = [];
	let httpServerProcessId = '';

	test.beforeAll(async ({ playwright }) => {
		request = await playwright.request.newContext({ baseURL: API_BASE_URL });
		const signIn = await request.post('/api/v1/auths/signin', {
			data: { email: '', password: '' }
		});
		expect(signIn.ok()).toBeTruthy();
		token = (await signIn.json()).token;
		expect(token).toEqual(expect.any(String));

		const terminals = await request.get('/api/v1/terminals/', {
			headers: authorizationHeaders(token)
		});
		expect(terminals.ok()).toBeTruthy();
		expect(
			(await terminals.json()).some((terminal: { id: string }) => terminal.id === TERMINAL_ID)
		).toBeTruthy();

		chats.push(await createChat(request, token, 'alpha'));
		chats.push(await createChat(request, token, 'beta'));
	});

	test.afterAll(async () => {
		if (!request) return;
		try {
			if (httpServerProcessId && chats[0]) {
				await request.delete(
					`${terminalPath(chats[0].id, `execute/${httpServerProcessId}`)}?force=true`,
					{ headers: authorizationHeaders(token) }
				);
			}
			for (const chat of chats) {
				await request.post(`${terminalPath(chat.id, 'execute')}?wait=10`, {
					headers: authorizationHeaders(token),
					data: { command: `rm -rf -- '${TEST_DIRECTORY}'` }
				});
				await request.delete(`/api/v1/chats/${chat.id}`, {
					headers: authorizationHeaders(token)
				});
			}
		} finally {
			await request.dispose();
		}
	});

	test('diagnostic: scopes filesystem, cwd, and command execution to each saved chat', async () => {
		test.info().annotations.push({
			type: 'evidence',
			description:
				'Live API diagnostic only; it does not prove browser rendering or model-directed tool use.'
		});
		const [alpha, beta] = chats;
		const alphaFile = `${TEST_DIRECTORY}/alpha.txt`;
		const betaFile = `${TEST_DIRECTORY}/beta.txt`;

		const alphaWrite = await request.post(`/api/v1/terminals/${TERMINAL_ID}/files/write`, {
			headers: requestWithChatHeader(token, alpha.id),
			data: { path: alphaFile, content: 'alpha-only' }
		});
		expect(alphaWrite.ok()).toBeTruthy();

		const betaWrite = await request.post(terminalPath(beta.id, 'files/write'), {
			headers: authorizationHeaders(token),
			data: { path: betaFile, content: 'beta-only' }
		});
		expect(betaWrite.ok()).toBeTruthy();

		const [alphaRead, betaRead, crossRead] = await Promise.all([
			request.get(`${terminalPath(alpha.id, 'files/read')}?path=${encodeURIComponent(alphaFile)}`, {
				headers: authorizationHeaders(token)
			}),
			request.get(`${terminalPath(beta.id, 'files/read')}?path=${encodeURIComponent(betaFile)}`, {
				headers: authorizationHeaders(token)
			}),
			request.get(`${terminalPath(beta.id, 'files/read')}?path=${encodeURIComponent(alphaFile)}`, {
				headers: authorizationHeaders(token)
			})
		]);
		expect((await alphaRead.json()).content).toBe('alpha-only');
		expect((await betaRead.json()).content).toBe('beta-only');
		expect(crossRead.status()).toBe(404);

		for (const chat of chats) {
			const cwd = await request.post(terminalPath(chat.id, 'files/cwd'), {
				headers: authorizationHeaders(token),
				data: { path: TEST_DIRECTORY }
			});
			expect(cwd.ok()).toBeTruthy();
			expect((await cwd.json()).cwd).toContain(TEST_DIRECTORY);
		}

		const commands = await Promise.all(
			chats.map((chat) =>
				request.post(`${terminalPath(chat.id, 'execute')}?wait=10`, {
					headers: authorizationHeaders(token),
					data: { command: `printf shell-${chat.label}-ok && pwd` }
				})
			)
		);
		for (const [index, command] of commands.entries()) {
			expect(command.ok()).toBeTruthy();
			const result = await command.json();
			expect(outputContains(result, `shell-${chats[index].label}-ok`)).toBeTruthy();
			expect(outputContains(result, TEST_DIRECTORY)).toBeTruthy();
		}
	});

	test('diagnostic: creates independent shells within one chat context', async () => {
		const sessions: string[] = [];
		try {
			for (let index = 0; index < 2; index++) {
				const created = await request.post(terminalPath(chats[0].id, 'api/terminals'), {
					headers: requestWithChatHeader(token, chats[0].id)
				});
				expect(created.ok()).toBeTruthy();
				sessions.push((await created.json()).id);
			}
			expect(new Set(sessions).size).toBe(2);
			expect(sessions).not.toContain(chats[0].id);
			const first = await request.get(terminalPath(chats[0].id, `api/terminals/${sessions[0]}`), {
				headers: authorizationHeaders(token)
			});
			const second = await request.get(terminalPath(chats[0].id, `api/terminals/${sessions[1]}`), {
				headers: authorizationHeaders(token)
			});
			expect((await first.json()).pid).not.toBe((await second.json()).pid);
		} finally {
			for (const id of new Set(sessions)) {
				await request.delete(terminalPath(chats[0].id, `api/terminals/${id}`), {
					headers: authorizationHeaders(token)
				});
			}
		}
	});

	test('diagnostic: proxies the chat-owned HTTP server and fails closed for invalid scopes', async () => {
		test.info().annotations.push({
			type: 'evidence',
			description:
				'Live API diagnostic only; browser preview and model-driven snapshot import remain separate proof.'
		});
		const [alpha, beta] = chats;
		const marker = `terminal-proxy-${crypto.randomUUID()}`;
		const pageFile = `${TEST_DIRECTORY}/index.html`;

		const write = await request.post(terminalPath(alpha.id, 'files/write'), {
			headers: authorizationHeaders(token),
			data: { path: pageFile, content: marker }
		});
		expect(write.ok()).toBeTruthy();

		const server = await request.post(terminalPath(alpha.id, 'execute'), {
			headers: authorizationHeaders(token),
			data: {
				command: `exec python3 -m http.server ${PORT} --bind 127.0.0.1`,
				cwd: TEST_DIRECTORY
			}
		});
		expect(server.ok()).toBeTruthy();
		httpServerProcessId = (await server.json()).id;
		expect(httpServerProcessId).toEqual(expect.any(String));

		await expect
			.poll(async () => {
				const ports = await request.get(terminalPath(alpha.id, 'ports'), {
					headers: authorizationHeaders(token)
				});
				if (!ports.ok()) return [];
				return (await ports.json()).ports;
			})
			.toContainEqual(expect.objectContaining({ port: PORT }));

		const proxied = await request.get(terminalPath(alpha.id, `proxy/${PORT}/index.html`), {
			headers: authorizationHeaders(token)
		});
		expect(proxied.ok()).toBeTruthy();
		expect(await proxied.text()).toBe(marker);

		let rawLocalhostExposed = false;
		try {
			const raw = await request.get(`http://127.0.0.1:${PORT}/index.html`, {
				failOnStatusCode: false,
				timeout: 2_000
			});
			rawLocalhostExposed = (await raw.text()) === marker;
		} catch {
			rawLocalhostExposed = false;
		}
		expect(rawLocalhostExposed).toBeFalsy();

		const [foreign, missing, conflict, otherChatPort] = await Promise.all([
			request.get(terminalPath(crypto.randomUUID(), 'files/list'), {
				headers: authorizationHeaders(token)
			}),
			request.get(`/api/v1/terminals/${TERMINAL_ID}/files/list`, {
				headers: authorizationHeaders(token)
			}),
			request.get(terminalPath(alpha.id, 'files/list'), {
				headers: requestWithChatHeader(token, beta.id)
			}),
			request.get(terminalPath(beta.id, `proxy/${PORT}/index.html`), {
				headers: authorizationHeaders(token)
			})
		]);
		expect(foreign.status()).toBe(404);
		expect(missing.status()).toBe(409);
		expect(conflict.status()).toBe(400);
		expect(otherChatPort.ok()).toBeFalsy();
		expect(await otherChatPort.text()).not.toContain(marker);
	});

	test('known gap: isolated Browser loads session-protected local script files', async ({
		page
	}) => {
		const chatId = chats[0].id;
		for (const [name, content] of Object.entries({
			'index.html':
				'<!doctype html><title>Runtime browser fixture</title><h1>Runtime browser fixture</h1><p id="count">0</p><button id="increment">Increment</button><script src="app.js"></script>',
			'app.js':
				'document.querySelector("#increment").onclick = () => { document.querySelector("#count").textContent = "1"; };'
		})) {
			const write = await request.post(terminalPath(chatId, 'files/write'), {
				headers: authorizationHeaders(token),
				data: { path: `${TEST_DIRECTORY}/${name}`, content }
			});
			expect(write.ok()).toBeTruthy();
		}

		const currentPorts = await request.get(terminalPath(chatId, 'ports'), {
			headers: authorizationHeaders(token)
		});
		const portIsListening =
			currentPorts.ok() &&
			(await currentPorts.json()).ports.some((port: { port: number }) => port.port === PORT);
		if (!portIsListening) {
			const server = await request.post(terminalPath(chatId, 'execute'), {
				headers: authorizationHeaders(token),
				data: {
					command: `exec python3 -m http.server ${PORT} --bind 127.0.0.1`,
					cwd: TEST_DIRECTORY
				}
			});
			expect(server.ok()).toBeTruthy();
			httpServerProcessId = (await server.json()).id;
			await expect
				.poll(async () => {
					const ports = await request.get(terminalPath(chatId, 'ports'), {
						headers: authorizationHeaders(token)
					});
					return ports.ok() ? (await ports.json()).ports : [];
				})
				.toContainEqual(expect.objectContaining({ port: PORT }));
		}

		const signIn = await page.request.post('/api/v1/auths/signin', {
			data: { email: '', password: '' }
		});
		expect(signIn.ok()).toBeTruthy();
		await page.addInitScript(
			(token) => localStorage.setItem('token', token),
			(await signIn.json()).token
		);
		await page.goto(`/c/${chatId}`);
		await dismissReleaseNotes(page);
		await page.getByRole('button', { name: 'Workspace', exact: true }).click();
		await page.getByRole('button', { name: 'Browser', exact: true }).click();
		await page.getByRole('button', { name: `localhost:${PORT} python3`, exact: true }).click();
		const frame = page.frameLocator('iframe');
		await expect(frame.getByRole('heading', { name: 'Runtime browser fixture' })).toBeVisible();
		await expect(page.locator('iframe')).not.toHaveAttribute('sandbox', /allow-same-origin/);
		await frame.getByRole('button', { name: 'Increment', exact: true }).click();
		// Keep the desired behavior executable without counting the known 401 as a pass.
		test.fail(
			true,
			'Opaque iframe subresource requests omit the session cookie; app.js returns 401.'
		);
		await expect(frame.locator('#count')).toHaveText('1');
	});
});
