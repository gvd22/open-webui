import assert from 'node:assert/strict';
import { mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

const root = new URL('../', import.meta.url);

test('requires source-map-backed renderer chunks instead of trusting a manifest', async () => {
	const vite = await readFile(new URL('../vite.config.ts', import.meta.url), 'utf8');
	assert.match(vite, /manifest:\s*true/);
	const checker = await import(new URL('./check-viewer-bundle.mjs', import.meta.url));
	for (const packageName of ['pdfjs-dist', 'docx-preview', 'xlsx']) {
		assert.equal(typeof checker.RENDERER_CHUNK_CEILINGS[packageName], 'number');
	}

	const fixtureDir = join(
		new URL('../', import.meta.url).pathname,
		`.viewer-bundle-${process.pid}`
	);
	await mkdir(join(fixtureDir, 'build/_app/immutable/chunks'), { recursive: true });
	await writeFile(
		join(fixtureDir, 'build/manifest.json'),
		JSON.stringify({ stale: 'pdfjs-dist docx-preview xlsx' })
	);
	assert.equal(checker.checkBuildSourceMaps(join(fixtureDir, 'build')).length, 3);
	for (const [name, source] of Object.entries({
		'pdfjs-dist': 'node_modules/pdfjs-dist/build/pdf.mjs',
		'docx-preview': 'node_modules/docx-preview/index.js',
		xlsx: 'node_modules/xlsx/xlsx.js'
	})) {
		const stem = name;
		await writeFile(join(fixtureDir, `build/_app/immutable/chunks/${stem}.js`), 'renderer');
		await writeFile(
			join(fixtureDir, `build/_app/immutable/chunks/${stem}.js.map`),
			JSON.stringify({ version: 3, file: `${stem}.js`, sources: [source] })
		);
	}
	assert.deepEqual(checker.checkBuildSourceMaps(join(fixtureDir, 'build')), []);
	await rm(fixtureDir, { recursive: true, force: true });
});

test('rejects a renderer chunk over its measured ceiling', async () => {
	const checker = await import(new URL('./check-viewer-bundle.mjs', import.meta.url));
	const fixtureDir = join(
		new URL('../', import.meta.url).pathname,
		`.viewer-bundle-over-${process.pid}`
	);
	await mkdir(join(fixtureDir, 'build/_app/immutable/chunks'), { recursive: true });
	await writeFile(join(fixtureDir, 'build/_app/immutable/chunks/pdfjs-dist.js'), 'renderer');
	await writeFile(
		join(fixtureDir, 'build/_app/immutable/chunks/pdfjs-dist.js.map'),
		JSON.stringify({
			version: 3,
			file: 'pdfjs-dist.js',
			sources: ['node_modules/pdfjs-dist/index.js']
		})
	);
	const errors = checker.checkBuildSourceMaps(join(fixtureDir, 'build'), {
		'pdfjs-dist': 1
	});
	assert.match(errors.join('\n'), /pdfjs-dist/);
	await rm(fixtureDir, { recursive: true, force: true });
});
