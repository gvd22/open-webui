import { DOMSerializer, type Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

// Decorations never enter the document JSON, autosave, clipboard, or undo history.
export function canvasChangeDecorations(before: ProseMirrorNode, after: ProseMirrorNode) {
	let start = before.content.findDiffStart(after.content);
	if (start === null) return DecorationSet.empty;
	const end = before.content.findDiffEnd(after.content);
	let oldEnd = Math.max(start, end?.a ?? start);
	let newEnd = Math.max(start, end?.b ?? start);
	const oldStart = before.resolve(start);
	const newStart = after.resolve(start);
	const inline =
		oldStart.parent.isTextblock &&
		oldStart.sameParent(before.resolve(oldEnd)) &&
		newStart.sameParent(after.resolve(newEnd)) &&
		oldStart.parent.sameMarkup(newStart.parent);

	if (inline) {
		// Keep changed words readable rather than highlighting individual letter fragments.
		const prefix = oldStart.nodeBefore;
		if (prefix?.isText) start -= prefix.text?.match(/\S+$/u)?.[0].length ?? 0;
		const oldSuffix = before.resolve(oldEnd).nodeAfter;
		const newSuffix = after.resolve(newEnd).nodeAfter;
		if (oldSuffix?.isText) oldEnd += oldSuffix.text?.match(/^\S+/u)?.[0].length ?? 0;
		if (newSuffix?.isText) newEnd += newSuffix.text?.match(/^\S+/u)?.[0].length ?? 0;
	} else {
		// Structural changes must render at document boundaries, never lists inside paragraphs.
		let first = 0;
		start = 0;
		while (
			first < Math.min(before.childCount, after.childCount) &&
			before.child(first).eq(after.child(first))
		) {
			start += before.child(first++).nodeSize;
		}
		let oldLast = before.childCount,
			newLast = after.childCount;
		oldEnd = before.content.size;
		newEnd = after.content.size;
		while (
			oldLast > first &&
			newLast > first &&
			before.child(oldLast - 1).eq(after.child(newLast - 1))
		) {
			oldEnd -= before.child(--oldLast).nodeSize;
			newEnd -= after.child(--newLast).nodeSize;
		}
	}
	const decorations: Decoration[] = [];
	const removed = before.slice(start, oldEnd).content;
	if (removed.size) {
		decorations.push(
			Decoration.widget(
				start,
				() => {
					const element = document.createElement(inline ? 'del' : 'div');
					element.className = 'canvas-removed-text';
					element.contentEditable = 'false';
					element.setAttribute('inert', '');
					element.appendChild(
						DOMSerializer.fromSchema(before.type.schema).serializeFragment(removed)
					);
					return element;
				},
				{ side: -1, stopEvent: () => true, ignoreSelection: true }
			)
		);
	}
	if (newEnd > start) {
		if (inline) {
			decorations.push(Decoration.inline(start, newEnd, { class: 'canvas-added-text' }));
		} else {
			after.forEach((node, offset) => {
				if (offset >= start && offset < newEnd) {
					decorations.push(
						Decoration.node(offset, offset + node.nodeSize, { class: 'canvas-added-text' })
					);
				}
			});
		}
	}
	return DecorationSet.create(after, decorations);
}
