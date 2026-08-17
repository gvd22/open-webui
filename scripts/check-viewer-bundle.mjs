import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Measured from a fresh production build; update only from --print-baseline output.
export const RENDERER_CHUNK_CEILINGS = Object.freeze({
	'pdfjs-dist': 2_252_800,
	'docx-preview': 204_800,
	'@aiden0z/pptx-renderer': 1_126_400
});

const packageNeedle = (name) => `node_modules/${name}`;

function filesUnder(directory, suffix) {
	if (!existsSync(directory)) return [];
	const files = [];
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) files.push(...filesUnder(path, suffix));
		else if (!suffix || entry.name.endsWith(suffix)) files.push(path);
	}
	return files;
}

export function checkBuildSourceMaps(buildRoot, ceilings = RENDERER_CHUNK_CEILINGS) {
	const mapFiles = filesUnder(join(buildRoot, '_app/immutable'), '.js.map');
	const packageFiles = new Map(Object.keys(ceilings).map((name) => [name, new Set()]));

	for (const mapFile of mapFiles) {
		let sourceMap;
		try {
			sourceMap = JSON.parse(readFileSync(mapFile, 'utf8'));
		} catch {
			continue;
		}
		const sources = Array.isArray(sourceMap.sources) ? sourceMap.sources : [];
		for (const packageName of packageFiles.keys()) {
			if (sources.some((source) => String(source).includes(packageNeedle(packageName)))) {
				packageFiles.get(packageName).add(mapFile.slice(0, -4));
			}
		}
	}

	// pdf.js emits the worker as a separate .mjs asset without a sibling source map.
	for (const worker of filesUnder(join(buildRoot, '_app/immutable/assets'), '.mjs')) {
		if (worker.split('/').pop()?.startsWith('pdf.worker.'))
			packageFiles.get('pdfjs-dist')?.add(worker);
	}

	const errors = [];
	for (const [packageName, ceiling] of Object.entries(ceilings)) {
		const files = packageFiles.get(packageName);
		if (!files?.size) {
			errors.push(`${packageName}: renderer chunk is absent from client source maps`);
			continue;
		}
		for (const file of files) {
			const size = statSync(file).size;
			if (size > ceiling)
				errors.push(`${packageName}: ${file} is ${size} bytes; ceiling is ${ceiling}`);
		}
	}
	return errors;
}

function buildRootFromArgs() {
	const root = resolve(fileURLToPath(new URL('../', import.meta.url)));
	const index = process.argv.indexOf('--build');
	return index === -1 ? join(root, 'build') : resolve(process.argv[index + 1]);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const buildRoot = buildRootFromArgs();
	try {
		const errors = checkBuildSourceMaps(buildRoot);
		if (process.argv.includes('--print-baseline')) {
			for (const [packageName, ceiling] of Object.entries(RENDERER_CHUNK_CEILINGS)) {
				const matching = filesUnder(join(buildRoot, '_app/immutable'), '.js').filter((file) => {
					const map = `${file}.map`;
					if (!existsSync(map)) return false;
					const sources = JSON.parse(readFileSync(map, 'utf8')).sources ?? [];
					return sources.some((source) => String(source).includes(packageNeedle(packageName)));
				});
				if (packageName === 'pdfjs-dist')
					matching.push(
						...filesUnder(join(buildRoot, '_app/immutable/assets'), '.mjs').filter((file) =>
							file.split('/').pop()?.startsWith('pdf.worker.')
						)
					);
				for (const file of new Set(matching))
					console.log(`${packageName}: ${statSync(file).size} bytes (ceiling ${ceiling})`);
			}
		}
		if (errors.length) {
			console.error(errors.join('\n'));
			process.exitCode = 1;
		} else {
			console.log('viewer bundle check passed');
		}
	} catch (error) {
		console.error(`viewer bundle unavailable: ${error.message}`);
		process.exitCode = 1;
	}
}
