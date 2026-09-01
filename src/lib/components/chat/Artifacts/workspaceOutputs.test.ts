import { describe, expect, it } from 'vitest';
import {
	createWorkspaceOutputFile,
	getWorkspaceOutputFilesFromHistory,
	isWorkspaceOutputPath,
	mergeWorkspaceOutputFiles
} from './workspaceOutputs';

describe('workspace output catalog', () => {
	it('accepts office outputs and rejects unsafe or unrelated paths', () => {
		expect(isWorkspaceOutputPath('/mnt/uploads/report.pdf')).toBe(true);
		expect(isWorkspaceOutputPath('/workspace/data.xlsx')).toBe(true);
		expect(isWorkspaceOutputPath('/workspace/index.html')).toBe(false);
		expect(isWorkspaceOutputPath('relative/report.pdf')).toBe(false);
		expect(isWorkspaceOutputPath('/workspace/bad\nreport.pdf')).toBe(false);
	});

	it('deduplicates one runtime path and keeps the newest metadata', () => {
		const first = createWorkspaceOutputFile('/workspace/report.pdf', {
			source: 'terminal',
			updatedAt: 10
		});
		const second = createWorkspaceOutputFile('/workspace/report.pdf', {
			source: 'terminal',
			page: 3,
			updatedAt: 20
		});
		expect(mergeWorkspaceOutputFiles([first!], [second])).toEqual([
			expect.objectContaining({ path: '/workspace/report.pdf', page: 3, updatedAt: 20 })
		]);
	});

	it('keeps identical paths from different runtimes separate', () => {
		const terminal = createWorkspaceOutputFile('/workspace/report.pdf', {
			source: 'terminal',
			terminalId: 'terminal-1',
			updatedAt: 10
		});
		const pyodide = createWorkspaceOutputFile('/workspace/report.pdf', {
			source: 'pyodide',
			updatedAt: 20
		});

		expect(mergeWorkspaceOutputFiles([], [terminal, pyodide])).toHaveLength(2);
	});

	it('restores terminal display files from persisted message output', () => {
		const history = {
			messages: {
				'assistant-1': {
					timestamp: 42,
					output: [
						{
							type: 'function_call_output',
							files: [
								{
									type: 'file',
									source: 'open_terminal',
									path: '/workspace/deck.pptx',
									name: 'deck.pptx',
									terminal_id: 'terminal-1'
								}
							]
						}
					]
				}
			}
		};
		expect(getWorkspaceOutputFilesFromHistory(history)).toEqual([
			expect.objectContaining({
				path: '/workspace/deck.pptx',
				source: 'terminal',
				terminalId: 'terminal-1'
			})
		]);
	});

	it('does not treat unrelated inline files as Pyodide outputs', () => {
		const history = {
			messages: {
				'assistant-1': {
					output: [
						{
							type: 'function_call_output',
							files: [{ type: 'file', path: '/api/v1/files/report.pdf', name: 'report.pdf' }]
						}
					]
				}
			}
		};

		expect(getWorkspaceOutputFilesFromHistory(history)).toEqual([]);
	});
});
