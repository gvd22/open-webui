"""Validation and merging for chat-scoped Pyodide output files."""

from __future__ import annotations

import math
from pathlib import PurePosixPath
from typing import BinaryIO

WORKSPACE_OUTPUTS_KEY = '_workspace_outputs'
WORKSPACE_OUTPUT_MAX_COUNT = 100
WORKSPACE_OUTPUT_MAX_PATH_CHARS = 1024
WORKSPACE_OUTPUT_MAX_ID_CHARS = 256
# Keep in sync with src/lib/pyodide/workspace.ts.
WORKSPACE_OUTPUT_MAX_UPLOAD_BYTES = 25 * 1024 * 1024
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


def validate_workspace_output_upload(file: BinaryIO, metadata: object) -> None:
    if not isinstance(metadata, dict) or metadata.get('source') != 'workspace-output':
        return
    position = file.tell()
    try:
        file.seek(0, 2)
        size = file.tell()
    finally:
        file.seek(position)
    if size > WORKSPACE_OUTPUT_MAX_UPLOAD_BYTES:
        raise ValueError('Workspace output exceeds the 25 MB upload limit.')


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
        if isinstance(updated_at, (int, float)) and not isinstance(updated_at, bool) and math.isfinite(updated_at)
        else 0
    )
    normalized = {
        'path': path,
        'name': parsed_path.name or 'Document',
        'source': 'pyodide',
        'page': page,
        'updatedAt': max(0, int(updated_at)),
    }
    for key in ('fileId', 'messageId', 'originChatId', 'contentType'):
        value = item.get(key)
        if (
            isinstance(value, str)
            and 0 < len(value) <= WORKSPACE_OUTPUT_MAX_ID_CHARS
            and not any(ord(char) < 32 or ord(char) == 127 for char in value)
        ):
            normalized[key] = value
    size = item.get('size')
    if isinstance(size, int) and not isinstance(size, bool) and size >= 0:
        normalized['size'] = size
    persisted_at = item.get('persistedAt')
    if (
        isinstance(persisted_at, (int, float))
        and not isinstance(persisted_at, bool)
        and math.isfinite(persisted_at)
        and persisted_at >= 0
    ):
        normalized['persistedAt'] = int(persisted_at)
    return normalized


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
            # A runtime change is recorded before its durable upload finishes. Keep
            # the last snapshot usable until a newer fileId arrives.
            if previous.get('fileId') and not item.get('fileId'):
                item.pop('size', None)
            item = {**previous, **item}
            item['updatedAt'] = max(previous['updatedAt'], item['updatedAt'])
        by_path[item['path']] = item
    return sorted(
        by_path.values(),
        key=lambda item: (-item['updatedAt'], item['name'].casefold()),
    )[:WORKSPACE_OUTPUT_MAX_COUNT]
