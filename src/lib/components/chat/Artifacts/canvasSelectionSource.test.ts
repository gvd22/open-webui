import { expect, it } from 'vitest';
import { canvasSelectionSource } from './canvasSelectionSource';

it.each([
	['A **bold** sentence.', 'A bold sentence.', 'A **bold** sentence.'],
	['# Heading', 'Heading', '# Heading'],
	['# Heading\n\nNext paragraph.', 'Heading', '# Heading'],
	['- First item\n- Second item', 'First item', '- First item'],
	[
		'# Heading\n\nFirst paragraph.\n\nSecond paragraph.',
		'First paragraph.\n\nSecond paragraph.',
		'First paragraph.\n\nSecond paragraph.'
	],
	['Some _italic_ and **bold** text.', 'italic and bold', '_italic_ and **bold**'],
	['Use [this link](https://example.com) today.', 'this link', '[this link](https://example.com)'],
	['A **long bold phrase**.', 'bold', 'bold'],
	['A &amp; B with &nbsp; space.', 'A & B with   space.', 'A &amp; B with &nbsp; space.'],
	['Use \\*literal\\* text.', '*literal*', '\\*literal\\*'],
	['- First item\n- Second item', 'First item\n\nSecond item', '- First item\n- Second item'],
	['A 😀 **bold** sentence.', '😀 bold', '😀 **bold**'],
	['Use `a < b` here.', 'a < b', '`a < b`'],
	['Use &zzzzunknown; today.', 'zzzzunknown', 'zzzzunknown'],
	['Use `&amp;` here.', 'amp', 'amp'],
	['Old paragraph.\n\nKeep this paragraph.', 'Old paragraph.', 'Old paragraph.'],
	['First line\nsecond line.', 'First line second line.', 'First line\nsecond line.']
])('maps visible text in %j back to its exact source', (source, selected, expected) => {
	expect(canvasSelectionSource(source, selected)).toBe(expected);
});

it.each([
	['Same.\n\nSame.', 'Same.'],
	['**same** and same', 'same'],
	['<script>hidden</script>', 'hidden'],
	['Before ![image](x.png) after', 'Before after'],
	['Unrelated', 'Missing'],
	['A &fjlig; entity.', 'f'],
	['a'.repeat(8001), 'a'.repeat(8001)]
])('rejects ambiguous, unsupported, missing or oversized selections', (source, selected) => {
	expect(canvasSelectionSource(source, selected)).toBeNull();
});
