import { marked } from 'marked';
import { decode } from 'html-entities';
import { canvasSelection } from './artifactEditing';

// Map visible Markdown text back to exact source; never guess across unsupported markup.
export function canvasSelectionSource(source: string, selection: string): string | null {
	const selected = selection.trim().replace(/\s+/gu, ' ');
	if (!selected || selection.length > 8000) return null;
	type Unit = { text: string; from: number; to: number };
	const units: Unit[] = [];
	const wrappers: { start: number; end: number; from: number; to: number }[] = [];
	const append = (text: string, from: number, to: number) => {
		for (const char of text) {
			if (/\s/u.test(char)) {
				if (units.at(-1)?.text === ' ') units[units.length - 1].to = to;
				else units.push({ text: ' ', from, to });
			} else units.push({ text: char, from, to });
		}
	};
	const literal = (raw: string, offset: number, decodeMarkdown = true) => {
		for (const match of raw.matchAll(
			/&(?:#\d+|#x[\da-f]+|[a-z][\da-z]*);|\\[!"#$%&'()*+,\-./:;<=>?@[\]\\^_`{|}~]|[\s\S]/giu
		)) {
			const value = decodeMarkdown ? decode(match[0].replace(/^\\([\W_])$/u, '$1')) : match[0];
			let from = offset + match.index!;
			if (value === match[0]) {
				for (const char of value) {
					append(char, from, from + char.length);
					from += char.length;
				}
			} else append(value, from, from + match[0].length);
		}
	};
	const visit = (tokens: any[], from: number, to: number, block: boolean) => {
		let cursor = from;
		for (const token of tokens) {
			if (typeof token.raw !== 'string') {
				append('\0', cursor, cursor);
				continue;
			}
			const start = source.indexOf(token.raw, cursor),
				end = start + token.raw.length;
			if (start < cursor || end > to) {
				append('\0', cursor, cursor);
				continue;
			}
			cursor = end;
			const first = units.length;
			if (token.type === 'space' || token.type === 'br') append(' ', start, end);
			else if (token.type === 'list') visit(token.items, start, end, true);
			else if (Array.isArray(token.tokens) && token.type !== 'html') {
				visit(token.tokens, start, end, token.type === 'list_item' || token.type === 'blockquote');
				if (['strong', 'em', 'del', 'link', 'list_item', 'heading'].includes(token.type)) {
					let last = units.length;
					while (last > first && units[last - 1].text === ' ') last--;
					wrappers.push({
						start: first,
						end: last,
						from: start,
						to: start + token.raw.trimEnd().length
					});
				}
			} else if (['text', 'escape'].includes(token.type)) literal(token.raw, start);
			else if (token.type === 'codespan' || token.type === 'code') {
				const text = token.type === 'codespan' ? decode(token.text) : token.text;
				const offset = token.raw.indexOf(text);
				if (offset < 0) append('\0', start, end);
				else {
					literal(text, start + offset, false);
					wrappers.push({
						start: first,
						end: units.length,
						from: start,
						to: start + token.raw.trimEnd().length
					});
				}
			} else append('\0', start, end);
			if (block) append(' ', end, end);
		}
	};
	visit(marked.lexer(source), 0, source.length, true);
	const visible = units.map((unit) => unit.text).join('');
	const index = visible.indexOf(selected);
	if (index < 0 || visible.indexOf(selected, index + 1) >= 0) return null;
	// UTF-16 search offsets are converted to the Unicode-character units above.
	const first = Array.from(visible.slice(0, index)).length;
	const last = first + Array.from(selected).length;
	// A partially selected multi-character entity has no independent source range.
	if (
		(units[first - 1]?.to ?? 0) > units[first].from ||
		(units[last]?.from ?? source.length) < units[last - 1].to
	)
		return null;
	let from = units[first].from,
		to = units[last - 1].to;
	for (const wrapper of wrappers) {
		if (first <= wrapper.start && last >= wrapper.end) {
			from = Math.min(from, wrapper.from);
			to = Math.max(to, wrapper.to);
		}
	}
	return canvasSelection(source, source.slice(from, to));
}
