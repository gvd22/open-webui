import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('release version gate compares the push before and current commit', async () => {
	const workflow = await readFile(
		new URL('../.github/workflows/release.yml', import.meta.url),
		'utf8'
	);
	assert.match(workflow, /fetch-depth:\s*0/);
	assert.match(workflow, /github\.event\.before/);
	assert.match(workflow, /github\.sha/);
	assert.match(workflow, /package\.json/);
	assert.doesNotMatch(workflow, /git diff --cached package\.json/);
	assert.match(workflow, /git cat-file -e/);
	assert.match(workflow, /0000000000000000000000000000000000000000/);
	assert.match(workflow, /DIFF_STATUS=\$\?/);
	assert.match(workflow, /DIFF_STATUS.*-eq 0/);
	assert.match(workflow, /DIFF_STATUS.*-eq 1/);
	assert.match(workflow, /DIFF_STATUS.*-gt 1/);
});
