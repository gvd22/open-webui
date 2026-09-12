"""Bounded, immutable text excerpts for inline tool-result comparisons."""


def artifact_changes(document: dict, *, preview: bool = False) -> list[dict]:
    previous = document.get('last_ai_update')
    if not isinstance(previous, dict):
        return []

    def text(value):
        return value if isinstance(value, str) else ''

    def file_text(value):
        return text(value.get('content')) if isinstance(value, dict) else text(value)

    pairs = [('Title', previous.get('title', ''), document.get('title', ''))]
    if preview:
        pairs.append(('Entrypoint', previous.get('entrypoint', ''), document.get('entrypoint', '')))
        before_files, after_files = previous.get('files') or {}, document.get('files') or {}
        pairs.extend(
            (path, file_text(before_files.get(path)), file_text(after_files.get(path)))
            for path in sorted(before_files.keys() | after_files.keys())
        )
    else:
        pairs.append(('Canvas', previous.get('content', ''), document.get('content', '')))
    changes = []
    budget = 12_000
    for path, before, after in pairs:
        before, after = text(before), text(after)
        if before == after:
            continue
        start = 0
        while start < min(len(before), len(after)) and before[start] == after[start]:
            start += 1
        end = 0
        while end < min(len(before), len(after)) - start and before[-1 - end] == after[-1 - end]:
            end += 1
        # Include the surrounding line, not fragments such as "is" versus "e" from "This/The".
        context_start = max(before.rfind('\n', 0, start) + 1, start - 200)
        old_end, new_end = len(before) - end, len(after) - end
        old_break, new_break = before.find('\n', old_end), after.find('\n', new_end)
        old_end = min(old_break if old_break >= 0 else len(before), old_end + 200)
        new_end = min(new_break if new_break >= 0 else len(after), new_end + 200)
        old = before[context_start:old_end]
        new = after[context_start:new_end]
        limit = min(3000, budget // 2)
        changes.append(
            {
                'path': path,
                'before': old[:limit],
                'after': new[:limit],
                'truncated': len(old) > limit or len(new) > limit,
            }
        )
        budget -= len(old[:limit]) + len(new[:limit])
        if budget <= 0 or len(changes) >= 24:
            changes[-1]['truncated'] = True
            break
    return changes
