import { loadPyodide, type PyodideInterface } from 'pyodide';
import {
	getWorkspaceFileChanges,
	MAX_WORKSPACE_OUTPUT_UPLOAD_BYTES,
	type WorkspaceOutputSnapshot,
	isValidPyodideEntryName,
	PYODIDE_WORKSPACE_ROOT,
	requirePyodideWorkspacePath
} from '$lib/pyodide/workspace';

declare global {
	interface Window {
		stdout: string | null;
		stderr: string | null;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		result: any;
		pyodide: PyodideInterface;
		packages: string[];
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		[key: string]: any;
	}
}

// ---------------------------------------------------------------------------
// Pyodide bootstrap
// ---------------------------------------------------------------------------

let pyodideReady: Promise<void> | null = null;
const installedPackages = new Set<string>();

const reportBootstrapStage = (stage: string, id?: string) => {
	self.postMessage({ type: 'pyodide:progress', stage, id });
};

async function loadPyodideAndPackages(id?: string) {
	self.stdout = null;
	self.stderr = null;
	self.result = null;

	reportBootstrapStage('loading-runtime', id);
	self.pyodide = await loadPyodide({
		indexURL: '/pyodide/',
		stdout: (text) => {
			console.log('Python output:', text);

			if (self.stdout) {
				self.stdout += `${text}\n`;
			} else {
				self.stdout = `${text}\n`;
			}
		},
		stderr: (text) => {
			console.log('An error occurred:', text);
			if (self.stderr) {
				self.stderr += `${text}\n`;
			} else {
				self.stderr = `${text}\n`;
			}
		},
		packages: ['micropip']
	});
	reportBootstrapStage('mounting-files', id);

	// Create the upload directory and mount IDBFS for persistence
	const uploadDir = PYODIDE_WORKSPACE_ROOT;
	self.pyodide.FS.mkdirTree(uploadDir);
	self.pyodide.FS.mount(self.pyodide.FS.filesystems.IDBFS, {}, '/mnt');

	// Load persisted files from IndexedDB
	reportBootstrapStage('restoring-files', id);
	await syncFS(true);
	reportBootstrapStage('preparing-runtime', id);

	// Ensure /mnt/uploads still exists after sync (first-time init)
	try {
		self.pyodide.FS.stat(uploadDir);
	} catch {
		self.pyodide.FS.mkdirTree(uploadDir);
	}

	await resetPythonWorkspace();
	reportBootstrapStage('ready', id);
}

/**
 * Ensure Pyodide is loaded. On the first call, loads and installs packages.
 * Subsequent calls reuse the already-loaded instance (persistent worker).
 */
async function ensurePyodide(packages: string[] = [], id?: string) {
	if (!pyodideReady) {
		const loading = loadPyodideAndPackages(id);
		pyodideReady = loading;
		try {
			await loading;
		} catch (error) {
			if (pyodideReady === loading) pyodideReady = null;
			throw error;
		}
	} else {
		await pyodideReady;
	}

	const missingPackages = packages.filter((name) => !installedPackages.has(name));
	if (missingPackages.length > 0 && self.pyodide) {
		const micropip = self.pyodide.pyimport('micropip');
		await micropip.install(missingPackages);
		for (const name of missingPackages) installedPackages.add(name);
	}
}

/**
 * Synchronize the mounted workspace before acknowledging filesystem mutations.
 */
function syncFS(populate: boolean) {
	if (!self.pyodide) return Promise.resolve();
	return new Promise<void>((resolve, reject) => {
		(self.pyodide.FS as any).syncfs(populate, (error: Error | null) => {
			if (error) reject(error);
			else resolve();
		});
	});
}

// ---------------------------------------------------------------------------
// FS operations
// ---------------------------------------------------------------------------

async function resetPythonWorkspace() {
	await self.pyodide.runPythonAsync(`import os
os.environ["HOME"] = "${PYODIDE_WORKSPACE_ROOT}"
os.chdir("${PYODIDE_WORKSPACE_ROOT}")`);
}

function fsUploadFiles(files: { name: string; data: ArrayBuffer }[], dir = PYODIDE_WORKSPACE_ROOT) {
	dir = requirePyodideWorkspacePath(dir);
	try {
		self.pyodide.FS.stat(dir);
	} catch {
		self.pyodide.FS.mkdirTree(dir);
	}

	for (const file of files) {
		if (!isValidPyodideEntryName(file.name)) throw new Error('Invalid Pyodide file name');
		const target = requirePyodideWorkspacePath(`${dir}/${file.name}`);
		self.pyodide.FS.writeFile(target, new Uint8Array(file.data));
	}
}

function fsList(path: string) {
	path = requirePyodideWorkspacePath(path);
	const entries: {
		name: string;
		type: 'file' | 'directory';
		size: number;
		modified?: number;
	}[] = [];
	const items = self.pyodide.FS.readdir(path).filter((n: string) => n !== '.' && n !== '..');
	for (const name of items) {
		try {
			const stat = self.pyodide.FS.stat(`${path}/${name}`);
			const isDir = self.pyodide.FS.isDir(stat.mode);
			entries.push({
				name,
				type: isDir ? 'directory' : 'file',
				size: isDir ? 0 : stat.size,
				...(stat.mtime instanceof Date ? { modified: stat.mtime.getTime() } : {})
			});
		} catch {
			// One entry may disappear between readdir and stat; keep the rest usable.
		}
	}
	return entries;
}

function fsRead(path: string): ArrayBuffer {
	path = requirePyodideWorkspacePath(path);
	const data: Uint8Array = (self.pyodide.FS as any).readFile(path) as Uint8Array;
	return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
}

function fsDelete(path: string) {
	path = requirePyodideWorkspacePath(path);
	if (path === PYODIDE_WORKSPACE_ROOT)
		throw new Error('The Pyodide workspace root cannot be deleted');
	const stat = self.pyodide.FS.stat(path);
	if (self.pyodide.FS.isDir(stat.mode)) {
		const items = self.pyodide.FS.readdir(path).filter((n: string) => n !== '.' && n !== '..');
		for (const item of items) {
			fsDelete(`${path}/${item}`);
		}
		self.pyodide.FS.rmdir(path);
	} else {
		self.pyodide.FS.unlink(path);
	}
}

function fsMkdir(path: string) {
	self.pyodide.FS.mkdirTree(requirePyodideWorkspacePath(path));
}

const OUTPUT_FILE_EXTENSIONS = new Set([
	'csv',
	'doc',
	'docx',
	'ods',
	'odt',
	'pdf',
	'ppt',
	'pptx',
	'xls',
	'xlsx'
]);
const MAX_OUTPUT_SNAPSHOT_BYTES = 64 * 1024 * 1024;

function fsListWorkspaceOutputs(limit = 100): Map<string, string> {
	const outputs = new Map<string, string>();
	const visit = (dir: string, depth: number) => {
		if (outputs.size >= limit || depth > 20) return;
		try {
			for (const name of self.pyodide.FS.readdir(dir)) {
				if (name === '.' || name === '..') continue;
				const path = `${dir}/${name}`.replace('//', '/');
				const stat = self.pyodide.FS.stat(path);
				if (self.pyodide.FS.isDir(stat.mode)) visit(path, depth + 1);
				else if (OUTPUT_FILE_EXTENSIONS.has(name.split('.').pop()?.toLowerCase() ?? '')) {
					outputs.set(path, `${stat.size}:${stat.mtime?.getTime?.() ?? 0}`);
				}
				if (outputs.size >= limit) return;
			}
		} catch {
			// One unreadable entry must not prevent the execution result from returning.
		}
	};
	visit(PYODIDE_WORKSPACE_ROOT, 0);
	return outputs;
}

function fsSnapshotWorkspaceOutputs(paths: string[]) {
	const snapshots: WorkspaceOutputSnapshot[] = [];
	let remainingBytes = MAX_OUTPUT_SNAPSHOT_BYTES;
	for (const path of paths) {
		try {
			const stat = self.pyodide.FS.stat(path);
			if (self.pyodide.FS.isDir(stat.mode) || !Number.isSafeInteger(stat.size) || stat.size < 0) {
				continue;
			}
			if (stat.size > MAX_WORKSPACE_OUTPUT_UPLOAD_BYTES) {
				snapshots.push({ path, size: stat.size });
				continue;
			}
			if (stat.size > remainingBytes) continue;
			const data = fsRead(path);
			if (data.byteLength > remainingBytes) continue;
			remainingBytes -= data.byteLength;
			snapshots.push({ path, size: data.byteLength, data });
		} catch {
			// The path remains visible in Files even if its durable snapshot cannot be captured.
		}
	}
	return snapshots;
}

// ---------------------------------------------------------------------------
// Code execution
// ---------------------------------------------------------------------------

async function executeCode(
	id: string,
	code: string,
	files?: { name: string; data: ArrayBuffer }[]
) {
	self.stdout = null;
	self.stderr = null;
	self.result = null;

	// Upload any accompanying files before execution
	if (files && files.length > 0) {
		fsUploadFiles(files);
		await syncFS(false);
	}
	const workspaceOutputsBefore = fsListWorkspaceOutputs();

	try {
		await resetPythonWorkspace();
		reportBootstrapStage('executing-code', id);
		// check if matplotlib is imported in the code
		if (code.includes('matplotlib')) {
			// Override plt.show() to return base64 image
			await self.pyodide.runPythonAsync(`import base64
import os
from io import BytesIO

# before importing matplotlib
# to avoid the wasm backend (which needs js.document', not available in worker)
os.environ["MPLBACKEND"] = "AGG"

import matplotlib.pyplot

_old_show = matplotlib.pyplot.show
assert _old_show, "matplotlib.pyplot.show"

def show(*, block=None):
	buf = BytesIO()
	matplotlib.pyplot.savefig(buf, format="png")
	buf.seek(0)
	# encode to a base64 str
	img_str = base64.b64encode(buf.read()).decode('utf-8')
	matplotlib.pyplot.clf()
	buf.close()
	print(f"data:image/png;base64,{img_str}")

matplotlib.pyplot.show = show`);
		}

		self.result = await self.pyodide.runPythonAsync(code);

		// Safely process and recursively serialize the result
		self.result = processResult(self.result);

		console.log('Python result:', self.result);
	} catch (error: unknown) {
		self.stderr = error instanceof Error ? error.message : String(error);
	}
	try {
		await syncFS(false);
	} catch (error: unknown) {
		const message = error instanceof Error ? error.message : String(error);
		self.stderr = [self.stderr, `Files could not be saved: ${message}`].filter(Boolean).join('\n');
	}

	const workspaceOutputsAfter = fsListWorkspaceOutputs();
	const workspaceFileChanges = getWorkspaceFileChanges(
		workspaceOutputsBefore,
		workspaceOutputsAfter
	);
	const workspaceFileSnapshots = fsSnapshotWorkspaceOutputs(workspaceFileChanges.changed);
	self.postMessage(
		{
			id,
			result: self.result,
			stdout: self.stdout,
			stderr: self.stderr,
			workspaceFiles: workspaceFileChanges.changed,
			workspaceDeletedFiles: workspaceFileChanges.deleted,
			workspaceFileSnapshots
		},
		{ transfer: workspaceFileSnapshots.flatMap(({ data }) => (data ? [data] : [])) }
	);
}

// ---------------------------------------------------------------------------
// Message handler
// ---------------------------------------------------------------------------

const handleMessage = async (data: any) => {
	const { id, type } = data;
	try {
		reportBootstrapStage('request-started', id);
		// Backward compatibility: messages without a `type` field are execute requests
		if (!type || type === 'execute') {
			const { code, files, ...context } = data;

			// Copy context keys (packages, etc.) into worker scope
			for (const key of Object.keys(context)) {
				if (key !== 'id' && key !== 'type') {
					self[key] = context[key];
				}
			}

			await ensurePyodide(self.packages, id);
			await executeCode(id, code, files);
			return;
		}

		// FS operations require Pyodide to be loaded
		await ensurePyodide([], id);

		switch (type) {
			case 'fs:upload': {
				const { files, dir } = data;
				fsUploadFiles(files, dir);
				await syncFS(false);
				self.postMessage({ id, type: 'fs:upload', success: true });
				break;
			}

			case 'fs:list': {
				const entries = fsList(data.path);
				self.postMessage({ id, type: 'fs:list', entries });
				break;
			}

			case 'fs:read': {
				try {
					const stat = self.pyodide.FS.stat(data.path);
					if (self.pyodide.FS.isDir(stat.mode)) throw new Error('Path is a directory');
					if (!Number.isSafeInteger(stat.size) || stat.size < 0) {
						throw new Error('File metadata is invalid');
					}
					if (Number.isSafeInteger(data.maxBytes) && stat.size > data.maxBytes) {
						throw new Error('File exceeds the read limit');
					}
					const buffer = fsRead(data.path);
					if (Number.isSafeInteger(data.maxBytes) && buffer.byteLength > data.maxBytes) {
						throw new Error('File exceeds the read limit');
					}
					self.postMessage({ id, type: 'fs:read', data: buffer }, { transfer: [buffer] });
				} catch (err: unknown) {
					self.postMessage({
						id,
						type: 'fs:read',
						error: err instanceof Error ? err.message : String(err)
					});
				}
				break;
			}

			case 'fs:delete': {
				fsDelete(data.path);
				await syncFS(false);
				self.postMessage({ id, type: 'fs:delete', success: true });
				break;
			}

			case 'fs:mkdir': {
				fsMkdir(data.path);
				await syncFS(false);
				self.postMessage({ id, type: 'fs:mkdir', success: true });
				break;
			}

			case 'fs:sync': {
				// Re-read from IndexedDB into memory to pick up externally written files
				await syncFS(true);
				self.postMessage({ id, type: 'fs:sync', success: true });
				break;
			}

			default:
				throw new Error(`Unknown Pyodide request type: ${String(type)}`);
		}
	} catch (error: unknown) {
		const message = error instanceof Error ? error.message : String(error);
		self.postMessage({
			id,
			type,
			error: message,
			...(!type || type === 'execute' ? { stderr: message } : {})
		});
	}
};

let messageQueue = Promise.resolve();
self.onmessage = (event) => {
	const data = event.data;
	reportBootstrapStage('request-queued', data?.id);
	messageQueue = messageQueue.then(() => handleMessage(data));
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function processResult(result: any): any {
	// Catch and always return JSON-safe string representations
	try {
		if (result == null) {
			// Handle null and undefined
			return null;
		}
		if (typeof result === 'string' || typeof result === 'number' || typeof result === 'boolean') {
			// Handle primitive types directly
			return result;
		}
		if (typeof result === 'bigint') {
			// Convert BigInt to a string for JSON-safe representation
			return result.toString();
		}
		if (Array.isArray(result)) {
			// If it's an array, recursively process items
			return result.map((item) => processResult(item));
		}
		if (typeof result.toJs === 'function') {
			// If it's a Pyodide proxy object (e.g., Pandas DF, Numpy Array), convert to JS and process recursively
			return processResult(result.toJs());
		}
		if (typeof result === 'object') {
			// Convert JS objects to a recursively serialized representation
			const processedObject: { [key: string]: any } = {};
			for (const key in result) {
				if (Object.prototype.hasOwnProperty.call(result, key)) {
					processedObject[key] = processResult(result[key]);
				}
			}
			return processedObject;
		}
		// Stringify anything that's left (e.g., Proxy objects that cannot be directly processed)
		return JSON.stringify(result);
	} catch (err: unknown) {
		// In case something unexpected happens, we return a stringified fallback
		return `[processResult error]: ${err instanceof Error ? err.message : String(err)}`;
	}
}

export default {};
