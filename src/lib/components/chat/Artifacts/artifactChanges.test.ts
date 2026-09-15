import { expect, it } from 'vitest';
import {
	buildOutputDisplayItems,
	dedupeCanvasDisplayItems,
	dedupeWebPreviewDisplayItems
} from '../Messages/structuredOutput';

it.each(['canvas', 'web_preview'])(
	'does not display legacy %s diffs in chat while preserving prose and card deduplication',
	(kind) => {
		const item = {
			type: `${kind}.document`,
			canvasId: 'one',
			previewId: 'one',
			title: 'Example',
			contentHash: 'hash',
			updatedAt: 3,
			changes: [{ path: 'Text', before: 'before', after: 'after', truncated: false }]
		};
		const result = buildOutputDisplayItems([
			{ type: 'message', id: 'before', content: [{ text: 'Before the edit' }] },
			{
				type: 'function_call_output',
				call_id: 'edit',
				output: [{ type: 'input_text', text: JSON.stringify(item) }]
			},
			{ type: 'message', id: 'after', content: [{ text: 'After the edit' }] }
		]);
		const deduped = dedupeWebPreviewDisplayItems(dedupeCanvasDisplayItems(result, ['one']), [
			'one'
		]);
		expect(deduped.map((item) => item.type)).toEqual(['message', 'message']);
	}
);
