import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);

test('defines focused viewer scripts and CI gates without the broken global check', async () => {
	const packageJson = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
	const frontend = await readFile(new URL('.github/workflows/frontend.yaml', root), 'utf8');
	const backend = await readFile(new URL('.github/workflows/backend.yaml', root), 'utf8');

	assert.equal(typeof packageJson.scripts['test:viewer'], 'string');
	assert.equal(typeof packageJson.scripts['test:viewer:build'], 'string');
	assert.equal(typeof packageJson.scripts['test:viewer:contracts'], 'string');
	for (const command of [
		'npm ci --force',
		'npm run test:viewer',
		'npm run build',
		'node scripts/check-viewer-dependencies.mjs'
	]) {
		assert.match(frontend, new RegExp(command.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')));
	}
	assert.match(backend, /pytest -q backend\/tests/);
	assert.match(frontend, /npm run test:frontend/);
	assert.match(frontend, /npm run test:viewer/);
	assert.match(frontend, /npm run test:viewer:contracts/);
	assert.doesNotMatch(frontend, /run:\s*(?:npm run )?check(?:\s|$)/m);
});
