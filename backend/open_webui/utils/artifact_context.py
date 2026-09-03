"""Shared bounded serialization for chat-scoped artifact context."""

import json

CONTEXT_TITLE_MAX_CHARS = 256


def bounded_context_title(value: object) -> str:
    title = str(value or '')
    if len(title) <= CONTEXT_TITLE_MAX_CHARS:
        return title
    return f'{title[: CONTEXT_TITLE_MAX_CHARS - 3]}...'


def safe_context_json(value: object) -> str:
    """Serialize untrusted data without raw markup or JSON line separators."""
    return (
        json.dumps(value, ensure_ascii=False, separators=(',', ':'))
        .replace('<', r'\u003c')
        .replace('>', r'\u003e')
        .replace('&', r'\u0026')
        .replace('\u2028', r'\u2028')
        .replace('\u2029', r'\u2029')
    )


def content_snapshot(content: str, kept_chars: int) -> dict:
    total_chars = len(content)
    if total_chars <= kept_chars:
        return {'truncated': False, 'total_chars': total_chars, 'content': content}

    prefix_chars = (kept_chars + 1) // 2
    suffix_chars = kept_chars // 2
    return {
        'truncated': True,
        'total_chars': total_chars,
        'included_chars': kept_chars,
        'omitted_chars': total_chars - kept_chars,
        'content_prefix': content[:prefix_chars],
        'content_suffix': content[total_chars - suffix_chars :] if suffix_chars else '',
    }
