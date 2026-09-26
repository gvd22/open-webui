import { expect, test } from '@playwright/test';

for (const runtime of ['sandbox', 'worker'] as const) {
	test(`serializes ${runtime} file operations and execution, with bounded reads and persistence`, async ({
		page
	}) => {
		await page.goto('/?code-interpreter=true');
		await expect(page.getByRole('button', { name: 'Files', exact: true })).toBeAttached();
		const result = await page.evaluate(async (runtime) => {
			const sandboxPath = '/src/lib/pyodide/pyodideSandboxHost.ts';
			const workerPath = '/src/lib/workers/pyodide.worker.ts?worker';
			const requestPath = '/src/lib/pyodide/workerRequest.ts';
			const { requestPyodideFile, executePyodide } = await import(requestPath);
			const create =
				runtime === 'sandbox' ? () => new sandbox.PyodideSandboxHost() : () => new native.default();
			const sandbox = await import(sandboxPath);
			const native = await import(workerPath);
			let host = create();
			try {
				const first = executePyodide(
					host,
					{
						code: "from pathlib import Path\nPath('sequence.txt').write_text('first')\n0",
						packages: []
					},
					() => {}
				);
				const second = executePyodide(
					host,
					{
						code: "from pathlib import Path\nPath('sequence.txt').write_text('second')\n0",
						packages: []
					},
					() => {}
				);
				const listing = requestPyodideFile(host, { type: 'fs:list', path: '/mnt/uploads' });
				const [a, b, list] = await Promise.all([first, second, listing]);
				const file = await requestPyodideFile(host, {
					type: 'fs:read',
					path: '/mnt/uploads/sequence.txt',
					maxBytes: 6
				});
				const readError = await requestPyodideFile(host, {
					type: 'fs:read',
					path: '/mnt/uploads/sequence.txt',
					maxBytes: 2
				}).then(
					() => '',
					(error: Error) => error.message
				);
				const uploadError = await requestPyodideFile(host, {
					type: 'fs:upload',
					dir: '/mnt/uploads',
					files: [{ name: '../outside.txt', data: new ArrayBuffer(0) }]
				}).then(
					() => '',
					(error: Error) => error.message
				);
				const pathError = await requestPyodideFile(host, {
					type: 'fs:read',
					path: '/etc/passwd'
				}).then(
					() => '',
					(error: Error) => error.message
				);
				await requestPyodideFile(host, {
					type: 'fs:upload',
					dir: '/mnt/uploads',
					files: [{ name: 'persistent.txt', data: new TextEncoder().encode('retained').buffer }]
				});
				let persisted = '';
				if (runtime === 'worker') {
					host.terminate();
					host = create();
					const saved = await requestPyodideFile(host, {
						type: 'fs:read',
						path: '/mnt/uploads/persistent.txt'
					});
					persisted = new TextDecoder().decode(saved.data);
				}
				await requestPyodideFile(host, { type: 'fs:delete', path: '/mnt/uploads/sequence.txt' });
				const deleted = await requestPyodideFile(host, {
					type: 'fs:read',
					path: '/mnt/uploads/sequence.txt'
				}).then(
					() => false,
					() => true
				);
				return {
					a,
					b,
					names: list.entries.map((entry: { name: string }) => entry.name),
					content: new TextDecoder().decode(file.data),
					readError,
					uploadError,
					pathError,
					persisted,
					deleted
				};
			} finally {
				host.terminate();
			}
		}, runtime);
		expect(result.a).toMatchObject({ result: 0, stderr: null });
		expect(result.b).toMatchObject({ result: 0, stderr: null });
		expect(result.names).toContain('sequence.txt');
		expect(result.content).toBe('second');
		expect(result.readError).toBe('File exceeds the read limit');
		expect(result.uploadError).toBe('Invalid Pyodide file name');
		expect(result.pathError).toContain('outside');
		expect(result.deleted).toBe(true);
		if (runtime === 'worker') expect(result.persisted).toBe('retained');
	});
}
