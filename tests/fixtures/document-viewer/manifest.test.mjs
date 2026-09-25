import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

const root = dirname(new URL(import.meta.url).pathname);
const manifestPath = resolve(root, 'manifest.json');
const maxCheckedInBytes = 262144;
const execFileAsync = promisify(execFile);

test('manifest describes exactly the three deterministic sanitized fixtures', async () => {
	const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
	assert.deepEqual(
		manifest.fixtures.map(({ path }) => path),
		['pdf/basic.pdf', 'docx/basic.docx', 'pptx/basic.pptx']
	);
	assert.equal(manifest.maxCheckedInBytes, maxCheckedInBytes);
	assert.deepEqual(manifest.prohibitedContent, [
		'personal data',
		'credentials',
		'external media',
		'tracking URLs'
	]);

	for (const fixture of manifest.fixtures) {
		assert.match(fixture.path, /^(pdf|docx|pptx)\/basic\.(pdf|docx|pptx)$/);
		assert.ok(fixture.format);
		assert.ok(fixture.purpose);
		assert.ok(fixture.sentinel);
		assert.ok(fixture.generator);
		assert.ok(fixture.source);
		assert.ok(fixture.ownership);
		assert.ok(fixture.license);
		assert.ok(fixture.knownLimitations);
		assert.match(fixture.sha256, /^[a-f0-9]{64}$/);
		assert.equal(typeof fixture.bytes, 'number');
		assert.ok(fixture.bytes > 0 && fixture.bytes <= maxCheckedInBytes);
		assert.equal(
			typeof fixture.expectedPages === 'number' || typeof fixture.expectedSlides === 'number',
			true
		);

		const fixturePath = resolve(root, fixture.path);
		const [file, fileStat] = await Promise.all([readFile(fixturePath), stat(fixturePath)]);
		assert.equal(fileStat.size, fixture.bytes, fixture.path);
		assert.equal(createHash('sha256').update(file).digest('hex'), fixture.sha256, fixture.path);
		if (fixture.format === 'pdf') {
			assert.equal(file.toString('ascii').match(/\/Type \/Page /g)?.length, fixture.expectedPages);
			assert.ok(
				file.includes(Buffer.from(fixture.sentinel)),
				`${fixture.path} contains its sentinel`
			);
		} else {
			const entry = fixture.format === 'docx' ? 'word/document.xml' : 'ppt/slides/slide1.xml';
			const extracted = await execFileAsync('unzip', ['-p', fixturePath, entry], {
				encoding: 'utf8'
			});
			assert.match(extracted.stdout, new RegExp(fixture.sentinel));
			assert.doesNotMatch(extracted.stdout, /utm_[a-z]+|tracking\.(example|invalid)/i);
			const listing = await execFileAsync('unzip', ['-Z1', fixturePath], { encoding: 'utf8' });
			assert.doesNotMatch(listing.stdout, /(^|\/)(media|embeddings)\//i);
		}
	}
});
