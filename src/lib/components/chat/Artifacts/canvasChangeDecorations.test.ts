import { expect, it } from 'vitest';
import { schema } from 'prosemirror-schema-basic';
import { canvasChangeDecorations } from './canvasChangeDecorations';

const doc = (text: string) =>
	schema.node('doc', null, [schema.node('paragraph', null, text ? schema.text(text) : undefined)]);

it.each([
	['A short sentence.', 'A clearer sentence.'],
	['', 'New paragraph'],
	['Removed paragraph', ''],
	['Hello', 'Hello again'],
	['Hello again', 'Hello'],
	['<script>old</script>', '<script>new</script>']
])('decorates %j to %j without changing either document', (beforeText, afterText) => {
	const before = doc(beforeText),
		after = doc(afterText);
	const original = after.toJSON();
	const changes = canvasChangeDecorations(before, after).find();
	expect(changes.length).toBeGreaterThan(0);
	expect(changes.every((change) => change.from >= 0 && change.to <= after.content.size)).toBe(true);
	expect(after.toJSON()).toEqual(original);
	expect(before.textContent).toBe(beforeText);
});

it('does not highlight unchanged documents', () => {
	expect(canvasChangeDecorations(doc('Unchanged'), doc('Unchanged')).find()).toEqual([]);
});

it('marks whole changed words rather than isolated letters', () => {
	const after = doc('The paragraph stays.');
	const changes = canvasChangeDecorations(doc('This paragraph stays.'), after).find();
	const added = changes.find((change) => change.to > change.from)!;
	expect(after.textBetween(added.from, added.to)).toBe('The');
});

it('supports removal of a complete block', () => {
	const before = schema.node('doc', null, [
		schema.node('paragraph', null, schema.text('Keep')),
		schema.node('paragraph', null, schema.text('Remove'))
	]);
	const after = doc('Keep');
	expect(canvasChangeDecorations(before, after).find().length).toBeGreaterThan(0);
});
