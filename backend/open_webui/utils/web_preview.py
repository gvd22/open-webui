"""Shared state helpers for chat-scoped Web Previews."""

from __future__ import annotations

import re
import time

from open_webui.models.chats import Chats
from open_webui.utils.chat_id import is_saved_chat_id

WEB_PREVIEW_DOCUMENTS_KEY = '_web_preview_documents'
WEB_PREVIEW_ACTIVE_DOCUMENT_KEY = '_web_preview_active_document_id'
WEB_PREVIEW_MAX_DOCUMENT_COUNT = 15
WEB_PREVIEW_MAX_FILE_COUNT = 40
WEB_PREVIEW_MAX_TOTAL_CHARS = 750_000

_TITLE_TAG = re.compile(r'<title[^>]*>(.*?)</title>', re.IGNORECASE | re.DOTALL)
_HEADING_TAG = re.compile(r'<h1[^>]*>(.*?)</h1>', re.IGNORECASE | re.DOTALL)
_HTML_TAG = re.compile(r'<[^>]+>')


def web_preview_timestamp(previous: int | float | None = None) -> int:
    """Return a frontend-safe timestamp that always advances for one document."""
    now = time.time_ns() // 1_000_000
    return max(now, int(previous or 0) + 1)


def generate_web_preview_title(files: dict, entrypoint: str = 'index.html', fallback: str = '') -> str:
    """Derive a concise title from a supplied title, HTML title, heading, or entrypoint."""

    def clean(value: str) -> str:
        return ' '.join(_HTML_TAG.sub('', value or '').split())

    def truncate(value: str) -> str:
        return f'{value[:45].rstrip()}...' if len(value) > 48 else value

    supplied = clean(fallback)
    if supplied:
        return truncate(supplied)

    entry = files.get(entrypoint) or {}
    content = entry.get('content', '') if isinstance(entry, dict) else str(entry)
    for pattern in (_TITLE_TAG, _HEADING_TAG):
        match = pattern.search(content)
        if match and clean(match.group(1)):
            return truncate(clean(match.group(1)))

    filename = entrypoint.rsplit('/', 1)[-1].rsplit('.', 1)[0].replace('-', ' ').replace('_', ' ').strip()
    return truncate(filename.title() if filename and filename.lower() != 'index' else 'Web Preview')


def normalize_web_preview_files(files: dict | None) -> dict[str, dict[str, str]]:
    """Normalize model-supplied text files and reject unsafe or oversized packages."""
    if not isinstance(files, dict) or not files:
        raise ValueError('At least one preview file is required.')
    if len(files) > WEB_PREVIEW_MAX_FILE_COUNT:
        raise ValueError(f'A preview can contain at most {WEB_PREVIEW_MAX_FILE_COUNT} files.')

    normalized: dict[str, dict[str, str]] = {}
    total_chars = 0
    for raw_path, raw_file in files.items():
        path = str(raw_path).replace('\\', '/').lstrip('/')
        if not path or path.startswith('../') or '/..' in path or path == '..':
            raise ValueError(f'Unsafe preview file path: {raw_path}')

        if isinstance(raw_file, dict):
            content = raw_file.get('content', '')
            mime = raw_file.get('mime', '')
        else:
            content = raw_file
            mime = ''
        if not isinstance(content, str):
            raise ValueError(f'Preview file content must be text: {path}')

        total_chars += len(content)
        if total_chars > WEB_PREVIEW_MAX_TOTAL_CHARS:
            raise ValueError('The preview package is too large for chat storage.')

        extension = path.rsplit('.', 1)[-1].lower() if '.' in path else ''
        default_mime = {
            'html': 'text/html',
            'htm': 'text/html',
            'css': 'text/css',
            'js': 'text/javascript',
            'mjs': 'text/javascript',
            'json': 'application/json',
            'svg': 'image/svg+xml',
            'txt': 'text/plain',
        }.get(extension, 'text/plain')
        normalized[path] = {'content': content, 'mime': str(mime or default_mime)}

    return normalized


def set_active_web_preview(chat_data: dict, preview_id: str) -> dict:
    documents = chat_data.get(WEB_PREVIEW_DOCUMENTS_KEY) or {}
    if preview_id not in documents:
        return chat_data
    return {**chat_data, WEB_PREVIEW_ACTIVE_DOCUMENT_KEY: preview_id}


def build_active_web_preview_prompt(chat_data: dict) -> str:
    documents = chat_data.get(WEB_PREVIEW_DOCUMENTS_KEY) or {}
    if not documents:
        return ''

    active_id = chat_data.get(WEB_PREVIEW_ACTIVE_DOCUMENT_KEY)
    catalog = '\n'.join(
        f'- preview_id: {preview_id}; title: {document.get("title", "") or "Untitled"}; '
        f'files: {", ".join(document.get("files", {}).keys())}'
        for preview_id, document in documents.items()
    )
    active = documents.get(active_id)
    if not active:
        return f"""[WEB PREVIEWS]
The user has these chat-scoped Web Previews:
{catalog}

There is no active Web Preview. If the user names one or asks to continue one, call
web_preview_select before updating it."""

    files = '\n\n'.join(
        f'<file path="{path}">\n{file.get("content", "")}\n</file>' for path, file in active.get('files', {}).items()
    )
    return f"""[WEB PREVIEWS]
The user has these chat-scoped Web Previews:
{catalog}

[ACTIVE WEB PREVIEW]
preview_id: {active_id}
title: {active.get('title', '')}
entrypoint: {active.get('entrypoint', 'index.html')}

{files}

When the user asks to modify the active preview, call web_preview_update with exactly this
preview_id and the complete file package. Create a new preview only when the user explicitly
asks for a separate result."""


async def get_active_web_preview_prompt(chat_id: str, user_id: str) -> str:
    if not is_saved_chat_id(chat_id):
        return ''
    chat = await Chats.get_chat_by_id(chat_id)
    if not chat or chat.user_id != user_id:
        return ''
    return build_active_web_preview_prompt(chat.chat or {})
