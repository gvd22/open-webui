import { describe, expect, it } from 'vitest';

import {
	generateCanvasTitle,
	canUseNotes,
	canSynchronizeCanvasDocumentChange,
	getCanvasNoteArtifactsFromHistory,
	getCanvasNoteArtifactsFromOutput,
	hasNewCanvasArtifact,
	mergePersistedCanvasArtifact,
	preserveWorkspaceSelection,
	type CanvasNoteArtifact
} from './canvas';
import {
	buildOutputDisplayItems,
	dedupeCanvasDisplayItems,
	type OutputDisplayItem
} from '../Messages/structuredOutput';

const artifact = (overrides: Partial<CanvasNoteArtifact> = {}): CanvasNoteArtifact => ({
	type: 'canvas-note',
	title: 'Notiz uber Bananen',
	content: '# Notiz uber Bananen\n\nNeu',
	canvasId: 'canvas-1',
	updatedAt: 20,
	source: 'tool',
	...overrides
});

describe('Canvas tool state', () => {
	it('keeps a meaningful title supplied by the Canvas tool', () => {
		expect(generateCanvasTitle('# Tagesausflug Bern\n\n- Anreise', 'Tagesausflug Bern')).toBe(
			'Tagesausflug Bern'
		);
	});

	it('replaces a generic placeholder with the document heading', () => {
		expect(generateCanvasTitle('# Bananen im Alltag\n\nText', 'Projekt-Notiz')).toBe(
			'Bananen im Alltag'
		);
	});

	it('parses the stable id and update metadata from a tool result', () => {
		const result = getCanvasNoteArtifactsFromOutput([
			{
				type: 'function_call_output',
				output: [
					{
						text: JSON.stringify({
							type: 'canvas.document',
							canvasId: 'canvas-1',
							title: 'Bananen',
							content: { md: '# Bananen' },
							updatedAt: 42,
							contentHash: 'canvas-hash-42',
							titleEdited: true,
							canUndoAiUpdate: true
						})
					}
				]
			}
		]);

		expect(result).toHaveLength(1);
		expect(result[0]).toMatchObject({
			canvasId: 'canvas-1',
			content: '# Bananen',
			updatedAt: 42,
			contentHash: 'canvas-hash-42',
			titleEdited: true,
			canUndoAiUpdate: true
		});
	});

	it('accepts only the Canvas tool result contract', () => {
		const result = getCanvasNoteArtifactsFromOutput([
			{
				type: 'function_call_output',
				output: JSON.stringify({
					type: 'koby.canvas.document',
					canvasId: 'canvas-legacy',
					content: { md: '# Legacy' }
				})
			}
		]);

		expect(result).toEqual([]);
	});

	it('recovers each latest Canvas document from the chat history', () => {
		const documentOutput = (canvasId: string, title: string, content: string) => [
			{
				type: 'function_call_output',
				output: JSON.stringify({
					type: 'canvas.document',
					canvasId,
					title,
					content: { md: content }
				})
			}
		];
		const history = {
			currentId: 'assistant-2',
			messages: {
				user: { id: 'user', role: 'user', parentId: null },
				'assistant-1': {
					id: 'assistant-1',
					role: 'assistant',
					parentId: 'user',
					output: documentOutput('canvas-1', 'Old trip', '# Old trip')
				},
				'assistant-2': {
					id: 'assistant-2',
					role: 'assistant',
					parentId: 'assistant-1',
					output: [
						...documentOutput('canvas-2', 'Breakfast', '# Breakfast'),
						...documentOutput('canvas-1', 'Day Trip', '# Day Trip')
					]
				}
			}
		};

		expect(getCanvasNoteArtifactsFromHistory(history)).toMatchObject([
			{ canvasId: 'canvas-1', title: 'Day Trip', content: '# Day Trip' },
			{ canvasId: 'canvas-2', title: 'Breakfast', content: '# Breakfast' }
		]);
	});

	it('keeps a Canvas tool error visible in the chat output', () => {
		expect(
			buildOutputDisplayItems([
				{
					type: 'function_call_output',
					id: 'error-1',
					output: JSON.stringify({
						type: 'canvas.error',
						message: 'Open a Canvas document first.'
					})
				}
			])
		).toEqual([
			{
				type: 'message',
				id: 'error-1',
				text: 'Open a Canvas document first.'
			}
		]);
	});

	it('shows the capacity warning after the document preview', () => {
		const output = buildOutputDisplayItems([
			{
				type: 'function_call_output',
				id: 'canvas-10-output',
				output: JSON.stringify({
					type: 'canvas.document',
					canvasId: 'canvas-10',
					title: 'Dokument 10',
					content: { md: '# Dokument 10' },
					warning: 'This chat contains 10 Canvas documents. You can create 5 more.'
				})
			}
		]);

		expect(output.map((item) => item.type)).toEqual(['canvas', 'message']);
		expect(output[1]).toMatchObject({
			text: 'This chat contains 10 Canvas documents. You can create 5 more.'
		});
	});

	it('does not let stale persisted state overwrite a newer tool update', () => {
		expect(
			mergePersistedCanvasArtifact(artifact(), {
				title: 'Notiz',
				content: '# Notiz',
				title_edited: true,
				updated_at: 10
			})
		).toMatchObject({
			title: 'Notiz uber Bananen',
			content: '# Notiz uber Bananen\n\nNeu',
			updatedAt: 20
		});
	});

	it('hydrates a newer direct edit and its linked Note', () => {
		expect(
			mergePersistedCanvasArtifact(artifact(), {
				title: 'Meine Bananen-Notiz',
				content: '# Meine Bananen-Notiz\n\nLokal bearbeitet',
				title_edited: true,
				updated_at: 30,
				note_id: 'note-1'
			})
		).toMatchObject({
			title: 'Meine Bananen-Notiz',
			content: '# Meine Bananen-Notiz\n\nLokal bearbeitet',
			titleEdited: true,
			updatedAt: 30,
			noteId: 'note-1'
		});
	});

	it('clears a deleted linked Note from hydrated Canvas state', () => {
		expect(
			mergePersistedCanvasArtifact(artifact({ noteId: 'deleted-note' }), {
				title: 'Notiz uber Bananen',
				content: '# Notiz uber Bananen\n\nNeu',
				updated_at: 30,
				note_id: null
			})
		).toMatchObject({ noteId: undefined });
	});

	it('hydrates compact partial-update tool results from persisted Canvas state', () => {
		const [reference] = getCanvasNoteArtifactsFromOutput([
			{
				type: 'function_call_output',
				output: JSON.stringify({
					type: 'canvas.document',
					canvasId: 'canvas-1',
					title: 'Plan',
					updatedAt: 40
				})
			}
		]);

		expect(reference.hasContentPayload).toBe(false);
		expect(
			mergePersistedCanvasArtifact(reference, {
				title: 'Plan',
				content: '# Plan\n\nTeilweise aktualisiert',
				updated_at: 40
			})
		).toMatchObject({
			content: '# Plan\n\nTeilweise aktualisiert',
			hasContentPayload: true
		});
	});

	it('opens the workspace for a new document but not another update of the same document', () => {
		expect(hasNewCanvasArtifact([], [artifact()])).toBe(true);
		expect(hasNewCanvasArtifact([artifact()], [artifact({ content: '# Updated' })])).toBe(false);
		expect(
			hasNewCanvasArtifact([artifact()], [artifact(), artifact({ canvasId: 'canvas-2' })])
		).toBe(true);
	});

	it('does not echo an externally applied Canvas update back as a local edit', () => {
		expect(canSynchronizeCanvasDocumentChange(true, 0, 10)).toBe(false);
		expect(canSynchronizeCanvasDocumentChange(false, 20, 10)).toBe(false);
		expect(canSynchronizeCanvasDocumentChange(false, 20, 20)).toBe(true);
	});

	it('allows Notes promotion only when Notes and the user permission are enabled', () => {
		expect(canUseNotes(true, 'admin', false)).toBe(true);
		expect(canUseNotes(true, 'user', true)).toBe(true);
		expect(canUseNotes(true, 'user', false)).toBe(false);
		expect(canUseNotes(true, 'user', undefined)).toBe(false);
		expect(canUseNotes(false, 'admin', true)).toBe(false);
	});

	it('preserves an existing Files, Terminal, Preview, or Canvas selection', () => {
		expect(preserveWorkspaceSelection('workspace:files', 'canvas-2')).toBe('workspace:files');
		expect(preserveWorkspaceSelection('preview-1', 'canvas-2')).toBe('preview-1');
		expect(preserveWorkspaceSelection(null, 'canvas-2')).toBe('canvas-2');
	});
});

describe('Canvas chat previews', () => {
	const canvasItem = (canvasId: string): OutputDisplayItem => ({
		type: 'canvas',
		id: canvasId,
		artifact: artifact({ canvasId, title: canvasId })
	});

	it('shows only the first preview for each document across chat messages', () => {
		const messageItem: OutputDisplayItem = {
			type: 'message',
			id: 'message-1',
			text: 'Der Inhalt wurde erweitert.'
		};

		expect(dedupeCanvasDisplayItems([messageItem, canvasItem('canvas-1')], ['canvas-1'])).toEqual([
			messageItem
		]);
	});

	it('keeps a completed update visible when its document already has a preview', () => {
		const activity: OutputDisplayItem = {
			type: 'canvas_activity',
			id: 'canvas-activity-2',
			name: 'canvas_update_document',
			done: true,
			artifact: artifact()
		};

		expect(dedupeCanvasDisplayItems([activity, canvasItem('canvas-1')], ['canvas-1'])).toEqual([
			activity
		]);
	});

	it('keeps one preview for every distinct document', () => {
		expect(
			dedupeCanvasDisplayItems([
				canvasItem('canvas-1'),
				canvasItem('canvas-1'),
				canvasItem('canvas-2')
			])
		).toEqual([canvasItem('canvas-1'), canvasItem('canvas-2')]);
	});

	it('renders Canvas tool progress before the first document preview', () => {
		const output = buildOutputDisplayItems([
			{
				type: 'function_call',
				id: 'canvas-call-1',
				call_id: 'canvas-call-1',
				name: 'canvas_create_document',
				status: 'completed'
			},
			{
				type: 'function_call_output',
				call_id: 'canvas-call-1',
				output: JSON.stringify({
					type: 'canvas.document',
					canvasId: 'canvas-1',
					title: 'Notiz uber Bananen',
					content: { md: '# Notiz uber Bananen' }
				})
			}
		]);

		expect(output.map((item) => item.type)).toEqual(['canvas_activity', 'canvas']);
		expect(output[0]).toMatchObject({
			name: 'canvas_create_document',
			done: true,
			artifact: { canvasId: 'canvas-1' }
		});
	});

	it('keeps a Canvas tool failure visible as activity context', () => {
		const output = buildOutputDisplayItems([
			{
				type: 'function_call',
				id: 'canvas-call-error',
				call_id: 'canvas-call-error',
				name: 'canvas_select_document',
				status: 'completed'
			},
			{
				type: 'function_call_output',
				call_id: 'canvas-call-error',
				output: JSON.stringify({
					type: 'canvas.error',
					message: 'Canvas document not found in this chat.'
				})
			}
		]);

		expect(output[0]).toMatchObject({
			type: 'canvas_activity',
			name: 'canvas_select_document',
			error: 'Canvas document not found in this chat.'
		});
	});

	it('renders bounded Canvas read and replace calls as workspace activities', () => {
		const output = buildOutputDisplayItems([
			{
				type: 'function_call',
				call_id: 'read-1',
				name: 'canvas_read_document',
				status: 'completed'
			},
			{
				type: 'function_call_output',
				call_id: 'read-1',
				output: JSON.stringify({ type: 'canvas.document_excerpt', canvasId: 'canvas-1' })
			},
			{
				type: 'function_call',
				call_id: 'replace-1',
				name: 'canvas_replace_text',
				status: 'completed'
			},
			{
				...artifact({ canvasId: 'canvas-1' }),
				type: 'function_call_output',
				call_id: 'replace-1',
				output: JSON.stringify({
					type: 'canvas.document',
					canvasId: 'canvas-1',
					title: 'Updated',
					content: { md: '# Updated' }
				})
			}
		]);

		expect(output.filter((item) => item.type === 'canvas_activity')).toMatchObject([
			{ name: 'canvas_read_document', done: true },
			{ name: 'canvas_replace_text', done: true, artifact: { canvasId: 'canvas-1' } }
		]);
	});
});
