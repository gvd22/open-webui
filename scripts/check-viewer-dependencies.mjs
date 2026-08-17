import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const VIEWER_LICENSES = Object.freeze({
	'pdfjs-dist': 'Apache-2.0',
	'docx-preview': 'Apache-2.0',
	'@aiden0z/pptx-renderer': 'Apache-2.0',
	jszip: '(MIT OR GPL-3.0-or-later)',
	echarts: 'Apache-2.0',
	zrender: 'BSD-3-Clause'
});

export const VIEWER_NOTICE_FILES = Object.freeze([
	'pdfjs-dist/LICENSE',
	'docx-preview/LICENSE',
	'@aiden0z/pptx-renderer/LICENSE',
	'jszip/LICENSE.markdown',
	'echarts/LICENSE',
	'echarts/NOTICE',
	'zrender/LICENSE'
]);

const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));

export function checkViewerDependencies(projectRoot = root) {
	const lockfile = readJson(join(projectRoot, 'package-lock.json'));
	const errors = [];

	for (const [name, expectedLicense] of Object.entries(VIEWER_LICENSES)) {
		const lockEntry = lockfile.packages?.[`node_modules/${name}`];
		const packageDir = join(projectRoot, 'node_modules', name);
		if (!lockEntry) {
			errors.push(`${name}: missing package-lock entry`);
			continue;
		}
		if (lockEntry.license !== expectedLicense) {
			errors.push(
				`${name}: package-lock license ${lockEntry.license ?? 'missing'} != ${expectedLicense}`
			);
		}
		const packageFile = join(packageDir, 'package.json');
		if (!existsSync(packageFile)) {
			errors.push(`${name}: installed package is missing`);
		} else if (readJson(packageFile).license !== expectedLicense) {
			errors.push(`${name}: package license does not match ${expectedLicense}`);
		}
	}

	for (const relativeFile of VIEWER_NOTICE_FILES) {
		if (!existsSync(join(projectRoot, 'node_modules', relativeFile))) {
			errors.push(`${relativeFile}: required notice file is missing`);
		}
	}
	return errors;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const errors = checkViewerDependencies();
	if (errors.length) {
		console.error(errors.join('\n'));
		process.exitCode = 1;
	} else {
		console.log(
			`viewer dependency/license check passed (${Object.keys(VIEWER_LICENSES).length} packages)`
		);
	}
}
