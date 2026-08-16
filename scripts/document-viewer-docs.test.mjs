import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const supportPath = new URL(
	'../docs/superpowers/specs/2026-08-16-koby-document-viewer-support.md',
	import.meta.url
);
const readinessPath = new URL(
	'../docs/superpowers/specs/2026-08-16-koby-document-viewer-production-readiness.md',
	import.meta.url
);

test('documents the supported formats, exact limits, and fallback behavior', async () => {
	const support = await readFile(supportPath, 'utf8');

	for (const required of [
		'PDF',
		'DOCX',
		'PPTX',
		'64 MiB',
		'48 MiB',
		'1,500 archive entries',
		'96 MiB uncompressed',
		'24,000,000 text-index bytes',
		'24,000,000 canvas pixels',
		'1,000 pages',
		'4x zoom',
		'read-only',
		'download',
		'last valid preview',
		'Files/FileNav',
		'XLSX',
		'CSV',
		'OpenDocument',
		'legacy Word/PowerPoint'
	]) {
		assert.match(support, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
	}
});

test('documents fidelity limits, pilot gates, rollback, privacy, and sign-off evidence', async () => {
	const readiness = await readFile(readinessPath, 'utf8');

	for (const required of [
		'ENABLE_DOCUMENT_VIEWER=true',
		'ENABLE_DOCUMENT_VIEWER=false',
		'Chromium',
		'Firefox',
		'WebKit',
		'Safari VoiceOver',
		'NVDA',
		'Microsoft Office',
		'LibreOffice',
		'Google exports',
		'No browser telemetry',
		'no document content or path logging',
		'PDF: first visible page <= 5 seconds',
		'DOCX: complete preview <= 5 seconds',
		'PPTX: first slide <= 5 seconds',
		'PDF peak renderer memory <= 500 MiB',
		'DOCX peak renderer memory <= 400 MiB',
		'PPTX peak renderer memory <= 500 MiB',
		'five sequential samples',
		'rollback',
		'Release owner',
		'Security/legal owner',
		'QA owner',
		'Pilot environment',
		'Evidence links',
		'Decision',
		'Rollback verified'
	]) {
		assert.match(readiness, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
	}
});

test('requires image health and legal verification before enabling the pilot', async () => {
	const readiness = await readFile(readinessPath, 'utf8');
	const buildIndex = readiness.indexOf('Build the intended image before enabling the pilot');
	const healthIndex = readiness.indexOf('verify `/health` is healthy');
	const legalIndex = readiness.indexOf('verify `/app/legal` notices are present');
	const pilotIndex = readiness.indexOf('set `ENABLE_DOCUMENT_VIEWER=true`');

	assert.ok(buildIndex >= 0, 'runbook must require building the intended image');
	assert.ok(healthIndex > buildIndex, 'health verification must follow the image build gate');
	assert.ok(legalIndex > healthIndex, 'legal notice verification must follow health verification');
	assert.ok(pilotIndex > legalIndex, 'pilot enablement must follow image, health, and legal gates');
});

test('requires a shared normal-refresh threshold for every viewer format', async () => {
	const readiness = await readFile(readinessPath, 'utf8');

	assert.match(readiness, /All formats: normal refresh <= 3 seconds/i);
	assert.match(readiness, /PDF: first visible page <= 5 seconds/i);
	assert.match(readiness, /DOCX: complete preview <= 5 seconds/i);
	assert.match(readiness, /PPTX: first slide <= 5 seconds/i);
});
