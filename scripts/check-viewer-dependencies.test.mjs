import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const required = {
	'pdfjs-dist': 'Apache-2.0',
	'docx-preview': 'Apache-2.0',
	'@aiden0z/pptx-renderer': 'Apache-2.0',
	jszip: '(MIT OR GPL-3.0-or-later)',
	echarts: 'Apache-2.0',
	zrender: 'BSD-3-Clause'
};

test('checks exact lockfile licenses and distributed notice files', async () => {
	const packageJson = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
	const lockfile = JSON.parse(await readFile(new URL('package-lock.json', root), 'utf8'));
	const notices = await readFile(new URL('LICENSE_NOTICE', root), 'utf8');

	for (const [name, license] of Object.entries(required)) {
		assert.equal(lockfile.packages[`node_modules/${name}`].license, license, name);
	}
	assert.match(packageJson.scripts['check:viewer:dependencies'], /check-viewer-dependencies\.mjs/);
	for (const file of [
		'pdfjs-dist/LICENSE',
		'docx-preview/LICENSE',
		'@aiden0z/pptx-renderer/LICENSE',
		'jszip/LICENSE.markdown',
		'echarts/LICENSE',
		'echarts/NOTICE',
		'zrender/LICENSE'
	]) {
		assert.match(notices, new RegExp(file.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')));
	}

	const result = spawnSync(process.execPath, ['scripts/check-viewer-dependencies.mjs'], {
		cwd: new URL('../', import.meta.url),
		encoding: 'utf8'
	});
	assert.equal(result.status, 0, result.stderr || result.stdout);
});
