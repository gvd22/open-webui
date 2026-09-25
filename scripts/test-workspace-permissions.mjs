import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, openSync, closeSync } from 'node:fs';
import { createServer } from 'node:net';
import path from 'node:path';

const root = process.cwd();
mkdirSync(path.join(root, '.tmp'), { recursive: true });
const data = mkdtempSync(path.join(root, '.tmp/permissions-'));
const probe = createServer();
probe.listen(0, '127.0.0.1');
await once(probe, 'listening');
const port = probe.address().port;
await new Promise((resolve) => probe.close(resolve));
const baseURL = `http://127.0.0.1:${port}`;
const log = openSync(path.join(data, 'server.log'), 'a');
const server = spawn(
	path.join(root, '.venv/bin/python'),
	['-m', 'uvicorn', 'open_webui.main:app', '--host', '127.0.0.1', '--port', String(port)],
	{
		env: {
			...process.env,
			PYTHONPATH: path.join(root, 'backend'),
			DATA_DIR: data,
			DATABASE_URL: `sqlite:///${data}/webui.db`,
			WEBUI_AUTH: 'true',
			WEBUI_SECRET_KEY: randomUUID(),
			ENABLE_DB_MIGRATIONS: 'true',
			ENABLE_SIGNUP: 'true',
			ENABLE_OPENAI_API: 'false',
			ENABLE_OLLAMA_API: 'false',
			REDIS_URL: '',
			WEBSOCKET_REDIS_URL: '',
			USER_PERMISSIONS_CHAT_FILE_UPLOAD: 'false',
			USER_PERMISSIONS_FEATURES_CODE_INTERPRETER: 'false',
			USER_PERMISSIONS_FEATURES_NOTES: 'false',
			ENABLE_DOCUMENT_VIEWER: 'true',
			ENABLE_NOTES: 'true',
			OFFLINE_MODE: 'true',
			HF_HUB_OFFLINE: '1',
			RAG_EMBEDDING_MODEL_AUTO_UPDATE: 'false',
			FRONTEND_BUILD_DIR: path.join(root, 'build')
		},
		stdio: ['ignore', log, log]
	}
);
closeSync(log);
const exited = once(server, 'exit');
try {
	let ready = false;
	for (let attempt = 0; attempt < 60; attempt++) {
		if (server.exitCode !== null) throw new Error(`Test backend stopped; see ${data}/server.log`);
		try {
			ready = (await fetch(`${baseURL}/health`, { signal: AbortSignal.timeout(1000) })).ok;
		} catch {
			/* Backend is still starting. */
		}
		if (ready) break;
		await new Promise((resolve) => setTimeout(resolve, 1000));
	}
	if (!ready) throw new Error(`Test backend did not start; see ${data}/server.log`);
	const tests = spawn(
		process.execPath,
		[
			'node_modules/@playwright/test/cli.js',
			'test',
			'--config',
			'playwright.workspace.config.ts',
			'tests/workspace/permissions.spec.ts',
			'--reporter=list',
			'--output',
			path.join(data, 'results')
		],
		{
			env: { ...process.env, WORKSPACE_E2E_RESTRICTED: '1', WORKSPACE_E2E_BASE_URL: baseURL },
			stdio: 'inherit'
		}
	);
	const [code] = await once(tests, 'exit');
	process.exitCode = code ?? 1;
} finally {
	server.kill('SIGTERM');
	await exited;
	console.log(`Isolated permission-test evidence: ${data}`);
}
