import { expect, test } from '@playwright/test';

test('serializes sandboxed Pyodide requests and reports filesystem changes and errors', async ({
	page
}) => {
	await page.goto('/');
	const result = await page.evaluate(async () => {
		const modulePath = '/src/lib/pyodide/pyodideSandboxHost.ts';
		const { PyodideSandboxHost } = await import(/* @vite-ignore */ modulePath);
		const abortHost = new PyodideSandboxHost() as unknown as Worker;
		let syntheticErrors = 0;
		abortHost.addEventListener('error', () => {
			syntheticErrors += 1;
			abortHost.terminate();
		});
		abortHost.addEventListener('error', () => {
			syntheticErrors += 1;
		});
		abortHost.dispatchEvent(new Event('error'));

		const host = new PyodideSandboxHost() as unknown as Worker;
		let nextId = 0;
		const progress: Array<{ id: string; stage: string }> = [];
		const onProgress = (event: MessageEvent) => {
			if (event.data?.type === 'pyodide:progress') progress.push(event.data);
		};
		host.addEventListener('message', onProgress);

		const call = (message: Record<string, unknown>) => {
			const id = `sandbox-e2e-${++nextId}`;
			return new Promise<Record<string, any>>((resolve, reject) => {
				const timeout = window.setTimeout(() => {
					host.removeEventListener('message', onMessage);
					reject(new Error(`Sandbox request timed out: ${id}`));
				}, 180_000);
				const onMessage = (event: MessageEvent) => {
					if (event.data?.id !== id || event.data?.type === 'pyodide:progress') return;
					window.clearTimeout(timeout);
					host.removeEventListener('message', onMessage);
					resolve(event.data);
				};
				host.addEventListener('message', onMessage);
				host.postMessage({ ...message, id });
			});
		};

		try {
			const outputPath = '/mnt/uploads/sandbox-e2e.pdf';
			const execute = call({
				type: 'execute',
				packages: [],
				code: `from pathlib import Path\nPath(${JSON.stringify(outputPath)}).write_bytes(b'first')\n0`
			});
			const overwrite = call({
				type: 'execute',
				packages: [],
				code: `from pathlib import Path\nPath(${JSON.stringify(outputPath)}).write_bytes(b'second')\n0`
			});
			const list = call({ type: 'fs:list', path: '/mnt/uploads' });
			const [execution, overwritten, listing] = await Promise.all([execute, overwrite, list]);
			const read = await call({ type: 'fs:read', path: outputPath, maxBytes: 6 });
			const oversizedRead = await call({ type: 'fs:read', path: outputPath, maxBytes: 2 });
			const invalidUpload = await call({
				type: 'fs:upload',
				dir: '/mnt/uploads',
				files: [{ name: '../escaped.txt', data: new TextEncoder().encode('blocked').buffer }]
			});
			const missingList = await call({ type: 'fs:list', path: '/mnt/uploads/missing' });
			const deletion = await call({
				type: 'execute',
				packages: [],
				code: `from pathlib import Path\nPath(${JSON.stringify(outputPath)}).unlink()\n0`
			});
			const missingDelete = await call({ type: 'fs:delete', path: outputPath });
			return {
				execution,
				firstSnapshotPaths:
					execution.workspaceFileSnapshots?.map((snapshot: { path: string }) => snapshot.path) ??
					[],
				firstSnapshotLengths:
					execution.workspaceFileSnapshots?.map(
						(snapshot: { data?: ArrayBuffer }) => snapshot.data?.byteLength
					) ?? [],
				firstSnapshot: new TextDecoder().decode(execution.workspaceFileSnapshots?.[0]?.data),
				secondSnapshotPaths:
					overwritten.workspaceFileSnapshots?.map((snapshot: { path: string }) => snapshot.path) ??
					[],
				secondSnapshotLengths:
					overwritten.workspaceFileSnapshots?.map(
						(snapshot: { data?: ArrayBuffer }) => snapshot.data?.byteLength
					) ?? [],
				secondSnapshot: new TextDecoder().decode(overwritten.workspaceFileSnapshots?.[0]?.data),
				listing,
				listedNames: listing.entries?.map((entry: { name: string }) => entry.name) ?? [],
				readLength: read.data?.byteLength,
				oversizedReadError: oversizedRead.error,
				invalidUploadError: invalidUpload.error,
				missingListError: missingList.error,
				deletedFiles: deletion.workspaceDeletedFiles,
				missingDeleteError: missingDelete.error,
				syntheticErrors,
				progress
			};
		} finally {
			host.removeEventListener('message', onProgress);
			host.terminate();
		}
	});

	expect(result.execution).toMatchObject({ result: 0, stderr: null });
	expect(result.execution.workspaceFiles).toContain('/mnt/uploads/sandbox-e2e.pdf');
	expect(result.listing).toMatchObject({ type: 'fs:list' });
	expect(result.listedNames).toContain('sandbox-e2e.pdf');
	expect(result.firstSnapshotPaths).toEqual(['/mnt/uploads/sandbox-e2e.pdf']);
	expect(result.firstSnapshotLengths).toEqual([5]);
	expect(result.firstSnapshot).toBe('first');
	expect(result.secondSnapshotPaths).toEqual(['/mnt/uploads/sandbox-e2e.pdf']);
	expect(result.secondSnapshotLengths).toEqual([6]);
	expect(result.secondSnapshot).toBe('second');
	expect(result.readLength).toBe(6);
	expect(result.oversizedReadError).toBe('File exceeds the read limit');
	expect(result.invalidUploadError).toBe('Invalid Pyodide file name');
	expect(result.missingListError).toBeTruthy();
	expect(result.deletedFiles).toContain('/mnt/uploads/sandbox-e2e.pdf');
	expect(result.missingDeleteError).toBeTruthy();
	expect(result.syntheticErrors).toBe(2);
	expect(result.progress.filter(({ stage }) => stage === 'request-started')).toHaveLength(9);
});
