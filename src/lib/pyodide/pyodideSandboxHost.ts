type MessageListener = (event: MessageEvent) => void;
type ErrorListener = (event: Event) => void;
type QueuedMessage = { message: unknown; transfer: Transferable[] };

const sandboxScript = String.raw`
(function () {
	let pyodide = null;
	let pyodideReady = null;
	let stdout = null;
	let stderr = null;
	const workspaceRoot = '/mnt/uploads';
	const installedPackages = new Set();

	function post(message, transfer) {
		parent.postMessage(message, '*', transfer || []);
	}

	function report(stage, id) {
		post({ type: 'pyodide:progress', stage: stage, id: id });
	}

	async function loadRuntime(id) {
		stdout = null;
		stderr = null;
		report('loading-runtime', id);
		pyodide = await loadPyodide({
			indexURL: self.__PYODIDE_INDEX_URL__ || '/pyodide/',
			stdout: function (text) {
				stdout = stdout ? stdout + text + '\n' : text + '\n';
			},
			stderr: function (text) {
				stderr = stderr ? stderr + text + '\n' : text + '\n';
			},
			packages: ['micropip']
		});
		report('mounting-files', id);
		pyodide.FS.mkdirTree(workspaceRoot);
		await resetPythonWorkspace();
		report('ready', id);
	}

	async function resetPythonWorkspace() {
		await pyodide.runPythonAsync('import os\nos.environ["HOME"] = "' + workspaceRoot + '"\nos.chdir("' + workspaceRoot + '")');
	}

	function requireWorkspacePath(path) {
		if (typeof path !== 'string' || !path.startsWith('/') || path.includes('\0')) {
			throw new Error('Path is outside the Pyodide workspace');
		}
		const parts = [];
		for (const part of path.split('/')) {
			if (!part || part === '.') continue;
			if (part === '..') parts.pop();
			else parts.push(part);
		}
		const normalized = '/' + parts.join('/');
		if (normalized !== workspaceRoot && !normalized.startsWith(workspaceRoot + '/')) {
			throw new Error('Path is outside the Pyodide workspace');
		}
		return normalized;
	}

	async function ensureRuntime(packages, id) {
		if (!pyodideReady) {
			const loading = loadRuntime(id);
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
		const missingPackages = (packages || []).filter(function (name) {
			return !installedPackages.has(name);
		});
		if (missingPackages.length > 0) {
			await pyodide.pyimport('micropip').install(missingPackages);
			for (const name of missingPackages) installedPackages.add(name);
		}
	}

	function ensureDir(dir) {
		try {
			pyodide.FS.stat(dir);
		} catch {
			pyodide.FS.mkdirTree(dir);
		}
	}

	function requireEntryName(name) {
		if (
			typeof name !== 'string' ||
			name.length === 0 ||
			name.length > 255 ||
			name === '.' ||
			name === '..' ||
			name.includes('/') ||
			name.includes('\\') ||
			/[\u0000-\u001f\u007f]/.test(name)
		) {
			throw new Error('Invalid Pyodide file name');
		}
		return name;
	}

	function upload(files, dir) {
		dir = requireWorkspacePath(dir || workspaceRoot);
		ensureDir(dir);
		for (const file of files || []) {
			const target = requireWorkspacePath(dir + '/' + requireEntryName(file.name));
			pyodide.FS.writeFile(target, new Uint8Array(file.data));
		}
	}

	function list(path) {
		path = requireWorkspacePath(path);
		const entries = [];
		const names = pyodide.FS.readdir(path).filter(function (name) {
			return name !== '.' && name !== '..';
		});
		for (const name of names) {
			try {
				const stat = pyodide.FS.stat(path + '/' + name);
				const isDir = pyodide.FS.isDir(stat.mode);
				entries.push({
					name: name,
					type: isDir ? 'directory' : 'file',
					size: isDir ? 0 : stat.size,
					modified: stat.mtime && stat.mtime.getTime ? stat.mtime.getTime() : undefined
				});
			} catch {}
		}
		return entries;
	}

	function remove(path) {
		path = requireWorkspacePath(path);
		if (path === workspaceRoot) throw new Error('The Pyodide workspace root cannot be deleted');
		const stat = pyodide.FS.stat(path);
		if (!pyodide.FS.isDir(stat.mode)) {
			pyodide.FS.unlink(path);
			return;
		}
		const names = pyodide.FS.readdir(path).filter(function (name) {
			return name !== '.' && name !== '..';
		});
		for (const name of names) remove(path + '/' + name);
		pyodide.FS.rmdir(path);
	}

	const outputExtensions = new Set(['csv', 'doc', 'docx', 'ods', 'odt', 'pdf', 'ppt', 'pptx', 'xls', 'xlsx']);
	const maxOutputSnapshotBytes = 64 * 1024 * 1024;

	function listWorkspaceOutputs() {
		const outputs = new Map();
		function visit(dir, depth) {
			if (outputs.size >= 100 || depth > 20) return;
			try {
				for (const name of pyodide.FS.readdir(dir)) {
					if (name === '.' || name === '..') continue;
					const path = (dir + '/' + name).replace('//', '/');
					const stat = pyodide.FS.stat(path);
					if (pyodide.FS.isDir(stat.mode)) visit(path, depth + 1);
					else if (outputExtensions.has((name.split('.').pop() || '').toLowerCase())) {
						outputs.set(path, String(stat.size) + ':' + String(stat.mtime && stat.mtime.getTime ? stat.mtime.getTime() : 0));
					}
					if (outputs.size >= 100) return;
				}
			} catch {}
		}
		visit(workspaceRoot, 0);
		return outputs;
	}

	function snapshotWorkspaceOutputs(paths) {
		const snapshots = [];
		let remainingBytes = maxOutputSnapshotBytes;
		for (const path of paths) {
			try {
				const safePath = requireWorkspacePath(path);
				const stat = pyodide.FS.stat(safePath);
				if (pyodide.FS.isDir(stat.mode) || !Number.isSafeInteger(stat.size) || stat.size < 0 || stat.size > remainingBytes) continue;
				const bytes = pyodide.FS.readFile(safePath);
				const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
				if (data.byteLength > remainingBytes) continue;
				remainingBytes -= data.byteLength;
				snapshots.push({ path: safePath, data: data });
			} catch {}
		}
		return snapshots;
	}

	function clean(value) {
		try {
			if (value == null) return null;
			if (['string', 'number', 'boolean'].includes(typeof value)) return value;
			if (typeof value === 'bigint') return value.toString();
			if (Array.isArray(value)) return value.map(clean);
			if (typeof value.toJs === 'function') return clean(value.toJs());
			if (typeof value === 'object') {
				const out = {};
				for (const key in value) {
					if (Object.prototype.hasOwnProperty.call(value, key)) out[key] = clean(value[key]);
				}
				return out;
			}
			return JSON.stringify(value);
		} catch (error) {
			return '[processResult error]: ' + (error && error.message ? error.message : String(error));
		}
	}

	async function patchMatplotlib() {
		await pyodide.runPythonAsync([
			'import base64',
			'import os',
			'from io import BytesIO',
			'os.environ["MPLBACKEND"] = "AGG"',
			'import matplotlib.pyplot',
			'_old_show = matplotlib.pyplot.show',
			'assert _old_show, "matplotlib.pyplot.show"',
			'def show(*, block=None):',
			// String.raw keeps \t as-is; the sandbox's JS parser turns it into a real tab
			'\tbuf = BytesIO()',
			'\tmatplotlib.pyplot.savefig(buf, format="png")',
			'\tbuf.seek(0)',
			'\timg_str = base64.b64encode(buf.read()).decode("utf-8")',
			'\tmatplotlib.pyplot.clf()',
			'\tbuf.close()',
			'\tprint(f"data:image/png;base64,{img_str}")',
			'matplotlib.pyplot.show = show'
		].join('\n'));
	}

	async function execute(id, code, files) {
		stdout = null;
		stderr = null;
		let result = null;
		if (files && files.length > 0) upload(files);
		const outputsBefore = listWorkspaceOutputs();
		try {
			await resetPythonWorkspace();
			report('executing-code', id);
			if (code.includes('matplotlib')) await patchMatplotlib();
			result = clean(await pyodide.runPythonAsync(code));
		} catch (error) {
			stderr = error && error.message ? error.message : String(error);
		}
		const outputsAfter = listWorkspaceOutputs();
		const workspaceFiles = [];
		for (const entry of outputsAfter) {
			if (outputsBefore.get(entry[0]) !== entry[1]) workspaceFiles.push(entry[0]);
		}
		const workspaceDeletedFiles = [];
		for (const path of outputsBefore.keys()) {
			if (!outputsAfter.has(path)) workspaceDeletedFiles.push(path);
		}
		const workspaceFileSnapshots = snapshotWorkspaceOutputs(workspaceFiles);
		post({
			id: id,
			result: result,
			stdout: stdout,
			stderr: stderr,
			workspaceFiles: workspaceFiles,
			workspaceDeletedFiles: workspaceDeletedFiles,
			workspaceFileSnapshots: workspaceFileSnapshots
		}, workspaceFileSnapshots.map(function (snapshot) { return snapshot.data; }));
	}

	async function handleMessage(data) {
		const id = data.id;
		try {
			report('request-started', id);
			if (!data.type || data.type === 'execute') {
				await ensureRuntime(data.packages || [], id);
				await execute(id, data.code, data.files);
				return;
			}
			await ensureRuntime([], id);
			switch (data.type) {
				case 'fs:upload':
					upload(data.files, data.dir);
					post({ id: id, type: data.type, success: true });
					break;
				case 'fs:list':
					post({ id: id, type: data.type, entries: list(data.path) });
					break;
				case 'fs:read':
					try {
						const path = requireWorkspacePath(data.path);
						const stat = pyodide.FS.stat(path);
						if (pyodide.FS.isDir(stat.mode)) throw new Error('Path is a directory');
						if (!Number.isSafeInteger(stat.size) || stat.size < 0) {
							throw new Error('File metadata is invalid');
						}
						if (Number.isSafeInteger(data.maxBytes) && stat.size > data.maxBytes) {
							throw new Error('File exceeds the read limit');
						}
						const bytes = pyodide.FS.readFile(path);
						const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
						if (Number.isSafeInteger(data.maxBytes) && buffer.byteLength > data.maxBytes) {
							throw new Error('File exceeds the read limit');
						}
						post({ id: id, type: data.type, data: buffer }, [buffer]);
					} catch (error) {
						post({ id: id, type: data.type, error: error && error.message ? error.message : String(error) });
					}
					break;
				case 'fs:delete':
					remove(data.path);
					post({ id: id, type: data.type, success: true });
					break;
				case 'fs:mkdir':
					pyodide.FS.mkdirTree(requireWorkspacePath(data.path));
					post({ id: id, type: data.type, success: true });
					break;
				case 'fs:sync':
					post({ id: id, type: data.type, success: true });
					break;
				default:
					throw new Error('Unknown Pyodide request type: ' + String(data.type));
			}
		} catch (error) {
			const message = error && error.message ? error.message : String(error);
			post({
				id: id,
				type: data.type,
				error: message,
				...(!data.type || data.type === 'execute' ? { stderr: message } : {})
			});
		}
	}

	let messageQueue = Promise.resolve();
	window.addEventListener('message', function (event) {
		if (event.source !== parent) return;
		const data = event.data || {};
		report('request-queued', data.id);
		messageQueue = messageQueue.then(
			function () { return handleMessage(data); },
			function () { return handleMessage(data); }
		);
	});
})();
`;

// indexURL must be absolute because about:srcdoc can't be a base URL
const pyodideIndexURL = `${globalThis.location?.origin ?? ''}/pyodide/`;

const sandboxHtml = `<!doctype html><html><head><meta charset="utf-8"><script>window.__PYODIDE_INDEX_URL__=${JSON.stringify(pyodideIndexURL)}</script></head><body><script src="${pyodideIndexURL}pyodide.js"></script><script>${sandboxScript}</script></body></html>`;

export class PyodideSandboxHost {
	onmessage: MessageListener | null = null;
	onerror: ErrorListener | null = null;

	private iframe: HTMLIFrameElement;
	private ready = false;
	private queue: QueuedMessage[] = [];
	private messageListeners = new Set<MessageListener>();
	private errorListeners = new Set<ErrorListener>();
	private onWindowMessage: (event: MessageEvent) => void;
	private onIframeLoad: () => void;
	private onIframeError: (event: Event) => void;

	constructor() {
		this.iframe = document.createElement('iframe');
		this.iframe.setAttribute('sandbox', 'allow-scripts');
		this.iframe.setAttribute('aria-hidden', 'true');
		this.iframe.setAttribute('title', 'pyodide-sandbox');
		this.iframe.style.display = 'none';
		this.iframe.srcdoc = sandboxHtml;

		this.onWindowMessage = (event: MessageEvent) => {
			if (event.source !== this.iframe.contentWindow) {
				return;
			}

			const messageEvent = { data: event.data } as MessageEvent;
			this.onmessage?.(messageEvent);
			for (const listener of this.messageListeners) {
				listener(messageEvent);
			}
		};

		this.onIframeLoad = () => {
			this.ready = true;
			for (const item of this.queue) {
				this.post(item.message, item.transfer);
			}
			this.queue = [];
		};

		this.onIframeError = (event: Event) => {
			this.dispatchEvent(event);
		};

		window.addEventListener('message', this.onWindowMessage);
		this.iframe.addEventListener('load', this.onIframeLoad, { once: true });
		this.iframe.addEventListener('error', this.onIframeError);
		document.body.appendChild(this.iframe);
	}

	postMessage(message: unknown, transfer: Transferable[] = []) {
		if (this.ready) {
			this.post(message, transfer);
		} else {
			this.queue.push({ message, transfer });
		}
	}

	addEventListener(type: 'message' | 'error', listener: MessageListener | ErrorListener) {
		if (type === 'message') {
			this.messageListeners.add(listener as MessageListener);
		} else if (type === 'error') {
			this.errorListeners.add(listener as ErrorListener);
		}
	}

	removeEventListener(type: 'message' | 'error', listener: MessageListener | ErrorListener) {
		if (type === 'message') {
			this.messageListeners.delete(listener as MessageListener);
		} else if (type === 'error') {
			this.errorListeners.delete(listener as ErrorListener);
		}
	}

	dispatchEvent(event: Event) {
		if (event.type !== 'error') return false;
		this.onerror?.(event);
		for (const listener of [...this.errorListeners]) listener(event);
		return !event.defaultPrevented;
	}

	terminate() {
		window.removeEventListener('message', this.onWindowMessage);
		this.iframe.removeEventListener('load', this.onIframeLoad);
		this.iframe.removeEventListener('error', this.onIframeError);
		this.messageListeners.clear();
		this.errorListeners.clear();
		this.onmessage = null;
		this.onerror = null;
		this.iframe.remove();
	}

	private post(message: unknown, transfer: Transferable[]) {
		this.iframe.contentWindow?.postMessage(message, '*', transfer);
	}
}
