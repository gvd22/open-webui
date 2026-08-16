import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig, type Plugin } from 'vite';

const harnessRoot = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(harnessRoot, '../../..');
const fixturesRoot = path.join(repositoryRoot, 'tests/fixtures/document-viewer');
const fixtureByPath: Record<string, string> = {
	'/workspace/basic.pdf': 'pdf/basic.pdf',
	'/workspace/basic.docx': 'docx/basic.docx',
	'/workspace/basic.pptx': 'pptx/basic.pptx'
};
type RuntimeMode = 'valid' | 'corrupt' | 'missing' | 'unavailable' | 'oversized';
type RuntimeState = { mode: RuntimeMode; revision?: 'a' | 'b'; delayMs?: number };
const state = new Map<string, RuntimeState>();
const requestCounts = new Map<string, number>();

const runtimeStateKey = (sessionId: string, filePath: string) => `${sessionId}:${filePath}`;

const nextRequestCount = (sessionId: string, filePath: string) => {
	const key = runtimeStateKey(sessionId, filePath);
	const count = (requestCounts.get(key) ?? 0) + 1;
	requestCounts.set(key, count);
	return count;
};

const getFixture = (filePath: string) =>
	fixtureByPath[filePath] ?? (/^\/workspace\/sequence-\d+\.pdf$/.test(filePath) ? 'pdf/basic.pdf' : undefined);

const withRevision = (bytes: Buffer, revision?: RuntimeState['revision']) => {
	if (!revision) return bytes;
	const replacement = revision === 'a' ? 'KOBY-REFRESH-VERSION-A' : 'KOBY-REFRESH-VERSION-B';
	return Buffer.from(bytes.toString('binary').replace('KOBY-BASIC-PDF-2-PAGES', replacement), 'binary');
};

const viewerRuntime = (): Plugin => ({
	name: 'document-viewer-test-runtime',
	configureServer(server) {
		server.middlewares.use(async (request, response, next) => {
			const url = new URL(request.url ?? '/', 'http://viewer.test');
			if (url.pathname === '/__viewer-runtime' && request.method === 'POST') {
				const chunks: Buffer[] = [];
				for await (const chunk of request) chunks.push(Buffer.from(chunk));
				const body = JSON.parse(Buffer.concat(chunks).toString()) as {
					path: string;
					sessionId?: string;
					resetRequestCount?: boolean;
				} & RuntimeState;
				const stateKey = runtimeStateKey(body.sessionId ?? 'default', body.path);
				state.set(stateKey, {
					mode: body.mode,
					revision: body.revision,
					delayMs: body.delayMs
				});
				if (body.resetRequestCount) requestCounts.set(stateKey, 0);
				response.statusCode = 204;
				response.end();
				return;
			}
			if (url.pathname !== '/runtime/files/view') return next();
			if (
				request.headers.authorization !== 'Bearer viewer-test-token' ||
				!request.headers['x-session-id']
			) {
				response.statusCode = 401;
				response.end();
				return;
			}
			const filePath = url.searchParams.get('path') ?? '';
			const sessionId = String(request.headers['x-session-id']);
			response.setHeader('X-Viewer-Test-Request-Count', nextRequestCount(sessionId, filePath));
			const fixture = getFixture(filePath);
			const runtimeState =
				state.get(runtimeStateKey(sessionId, filePath)) ??
				({ mode: 'valid' as const });
			if (!fixture || runtimeState.mode === 'missing' || runtimeState.mode === 'unavailable') {
				response.statusCode = runtimeState.mode === 'missing' ? 404 : 503;
				response.end();
				return;
			}
			if (runtimeState.mode === 'oversized') {
				response.statusCode = 200;
				response.setHeader('Content-Type', 'application/octet-stream');
				response.setHeader('Content-Length', 64 * 1024 * 1024 + 1);
				response.setHeader('X-Viewer-Body-Bytes', '1');
				// Firefox does not resolve fetch from headers until a body byte arrives.
				// The viewer cancels this stream from Content-Length before consuming it.
				response.write(Buffer.from([0]));
				request.once('close', () => response.end());
				return;
			}
			const source = runtimeState.mode === 'corrupt'
				? Buffer.from('not a document')
				: await readFile(path.join(fixturesRoot, fixture));
			const bytes = withRevision(source, runtimeState.revision);
			if (runtimeState.delayMs) await new Promise((resolve) => setTimeout(resolve, runtimeState.delayMs));
			response.setHeader('Content-Type', 'application/octet-stream');
			response.setHeader('Content-Length', bytes.byteLength);
			if (runtimeState.revision) response.setHeader('X-Viewer-Revision', runtimeState.revision);
			response.end(bytes);
		});
	}
});

export default defineConfig({
	root: harnessRoot,
	server: { hmr: false },
	plugins: [svelte(), viewerRuntime()],
	define: {
		APP_VERSION: JSON.stringify('viewer-test'),
		APP_BUILD_HASH: JSON.stringify('viewer-test')
	},
	resolve: {
		alias: {
			$lib: path.join(repositoryRoot, 'src/lib'),
			'$app/environment': path.join(harnessRoot, 'src/app-environment.ts')
		}
	}
});
