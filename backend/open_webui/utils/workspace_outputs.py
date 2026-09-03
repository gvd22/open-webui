"""Validation and merging for chat-scoped Pyodide output files."""

from __future__ import annotations

import math
from pathlib import PurePosixPath

WORKSPACE_OUTPUTS_KEY = '_workspace_outputs'
WORKSPACE_OUTPUT_MAX_COUNT = 100
WORKSPACE_OUTPUT_MAX_PATH_CHARS = 1024
WORKSPACE_OUTPUT_EXTENSIONS = {
    'csv',
    'doc',
    'docx',
    'ods',
    'odt',
    'pdf',
    'ppt',
    'pptx',
    'xls',
    'xlsx',
}


def normalize_workspace_output(item: object) -> dict | None:
    if not isinstance(item, dict):
        return None
    path = str(item.get('path') or '')
    parsed_path = PurePosixPath(path)
    if (
        not path.startswith('/mnt/uploads/')
        or len(path) > WORKSPACE_OUTPUT_MAX_PATH_CHARS
        or any(ord(char) < 32 or ord(char) == 127 for char in path)
        or '..' in parsed_path.parts
        or str(parsed_path) != path
        or parsed_path.suffix.lower().lstrip('.') not in WORKSPACE_OUTPUT_EXTENSIONS
    ):
        return None
    page = item.get('page')
    page = page if isinstance(page, int) and not isinstance(page, bool) and page > 0 else None
    updated_at = item.get('updatedAt')
    updated_at = (
        updated_at
        if isinstance(updated_at, (int, float))
        and not isinstance(updated_at, bool)
        and math.isfinite(updated_at)
        else 0
    )
    return {
        'path': path,
        'name': parsed_path.name or 'Document',
        'source': 'pyodide',
        'page': page,
        'updatedAt': max(0, int(updated_at)),
    }


def merge_workspace_outputs(
    current: object,
    upsert: object,
    remove: object,
) -> list[dict]:
    by_path = {
        item['path']: item
        for candidate in (current if isinstance(current, list) else [])
        if (item := normalize_workspace_output(candidate)) is not None
    }
    removed = {
        path
        for candidate in (remove if isinstance(remove, list) else [])
        if isinstance(candidate, str) and (path := candidate) in by_path
    }
    for path in removed:
        by_path.pop(path, None)
    for candidate in upsert if isinstance(upsert, list) else []:
        item = normalize_workspace_output(candidate)
        if item is None:
            raise ValueError('Invalid Pyodide output file.')
        previous = by_path.get(item['path'])
        if previous:
            item['updatedAt'] = max(previous['updatedAt'], item['updatedAt'])
        by_path[item['path']] = item
    return sorted(
        by_path.values(),
        key=lambda item: (-item['updatedAt'], item['name'].casefold()),
    )[:WORKSPACE_OUTPUT_MAX_COUNT]
