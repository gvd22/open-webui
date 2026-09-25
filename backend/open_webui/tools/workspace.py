"""Chat-scoped Canvas, Web Preview and document-display tools."""

import hashlib
import json
import logging
import uuid
from pathlib import PurePosixPath

from fastapi import Request

from open_webui.models.chats import Chats
from open_webui.models.config import Config
from open_webui.utils.canvas import (
    CANVAS_ACTIVE_DOCUMENT_KEY,
    CANVAS_DOCUMENTS_KEY,
    CANVAS_MAX_DOCUMENT_COUNT,
    CanvasConflictError,
    build_canvas_capacity_notice,
    build_canvas_document_update,
    canvas_document_limit_reached,
    canvas_timestamp,
    generate_canvas_title,
    linked_canvas_note_exists,
    set_active_canvas_document,
    sync_linked_canvas_note_content,
)
from open_webui.utils.chat_id import is_saved_chat_id
from open_webui.utils.json_codec import JSONCodec
from open_webui.utils.note_events import emit_note_updated as _emit_note_updated
from open_webui.utils.web_preview import (
    WEB_PREVIEW_ACTIVE_DOCUMENT_KEY,
    WEB_PREVIEW_DOCUMENTS_KEY,
    WEB_PREVIEW_MAX_DOCUMENT_COUNT,
    WebPreviewConflictError,
    build_web_preview_capacity_notice,
    build_web_preview_document_update,
    generate_web_preview_title,
    normalize_web_preview_files,
    require_web_preview_precondition,
    set_active_web_preview,
    web_preview_content_hash,
    web_preview_timestamp,
)

log = logging.getLogger(__name__)

WEB_PREVIEW_RUNTIME_IMPORT_MAX_BYTES = 512_000


def _canvas_tool_error(message: str) -> str:
    return json.dumps({'type': 'canvas.error', 'message': message}, ensure_ascii=False)


def _canvas_tool_conflict(exc: CanvasConflictError) -> str:
    return json.dumps(exc.payload, ensure_ascii=False)


def _canvas_tool_document(document: dict, warning: str = '') -> str:
    return json.dumps(
        {
            'type': 'canvas.document',
            'canvasId': document['canvas_id'],
            'title': document.get('title', ''),
            'updatedAt': int(document.get('updated_at') or 0),
            'contentHash': _content_hash(document.get('content', '')),
            'titleEdited': bool(document.get('title_edited', False)),
            'noteId': document.get('note_id'),
            'canUndoAiUpdate': bool(document.get('last_ai_update')),
            **({'warning': warning} if warning else {}),
        },
        ensure_ascii=False,
    )


def _text_excerpt(content: str, start_line: int, end_line: int, query: str = '') -> dict:
    lines = content.splitlines(keepends=True)
    total_lines = len(lines)
    if total_lines == 0:
        return {
            'startLine': 0,
            'endLine': 0,
            'totalLines': 0,
            'content': '',
            'excerptTruncated': False,
        }
    if query.strip():
        needle = query.casefold()
        match = next((index for index, line in enumerate(lines) if needle in line.casefold()), None)
        if match is None:
            raise ValueError('The requested text was not found.')
        radius = max(5, min(100, (end_line - start_line + 1) // 2))
        start_line = max(1, match + 1 - radius)
        end_line = min(total_lines, match + 1 + radius)
    else:
        start_line = min(total_lines, max(1, start_line))
        end_line = min(total_lines, max(start_line, end_line))
    if end_line - start_line + 1 > 400:
        end_line = start_line + 399
    excerpt = ''.join(lines[start_line - 1 : end_line])
    excerpt_truncated = len(excerpt) > 24_000
    if len(excerpt) > 24_000:
        excerpt = excerpt[:24_000]
    return {
        'startLine': start_line,
        'endLine': end_line,
        'totalLines': total_lines,
        'content': excerpt,
        'excerptTruncated': excerpt_truncated,
    }


def _content_hash(content: str) -> str:
    return hashlib.sha256(content.encode()).hexdigest()


async def _get_artifact_chat(__chat_id__: str | None, __user__: dict | None):
    """Return the owner-visible chat that holds chat-bound artifacts."""
    if not is_saved_chat_id(__chat_id__):
        return None

    chat = await Chats.get_chat_by_id(__chat_id__)
    user_id = (__user__ or {}).get('id')
    return chat if chat and chat.user_id == user_id else None


async def _mutate_artifact_chat(chat, mutator, artifact_label: str):
    mutation = await Chats.mutate_chat_by_id(
        chat.id,
        mutator,
        user_id=chat.user_id,
        touch=False,
    )
    if mutation is None:
        raise RuntimeError(f'{artifact_label} chat could not be persisted.')
    return mutation[1]


# =============================================================================
# CHAT CANVAS TOOLS
# =============================================================================


async def canvas_create_document(
    content: str,
    title: str = '',
    __chat_id__: str | None = None,
    __user__: dict | None = None,
    __metadata__: dict | None = None,
) -> str:
    """Create a new editable Canvas document in this chat.

    Canvas is a transient working document. Use this only when the user asks for
    a separate or new document. If a Canvas document is already active and the
    user asks to continue, expand, rewrite, correct, or edit it, use
    canvas_update_document instead. Supply the complete document content in the
    content argument, not a description of the change.

    A chat can contain at most 15 Canvas documents. A capacity warning is
    returned from the 10th document onward.

    :param content: Complete Markdown content for the new document.
    :param title: Optional short document title. Leave empty when the content should determine it.
    :return: A compact reference to the Canvas document, including its stable canvasId.
    """
    chat = await _get_artifact_chat(__chat_id__, __user__)
    if chat is None:
        return _canvas_tool_error('Canvas is available only in a saved chat.')

    focus = (__metadata__ or {}).get('workspace_focus')
    if isinstance(focus, dict) and 'selection' in focus:
        return _canvas_tool_error('A selection edit must use canvas_replace_text, not create a document.')
    now = canvas_timestamp()
    canvas_id = f'canvas-{uuid.uuid4()}'
    document = {
        'canvas_id': canvas_id,
        'title': generate_canvas_title(content, title),
        'content': content,
        'title_edited': bool(title.strip()),
        'created_at': now,
        'updated_at': now,
    }

    def mutate(chat_data: dict, _session):
        documents = dict(chat_data.get(CANVAS_DOCUMENTS_KEY) or {})
        if canvas_document_limit_reached(len(documents)):
            raise ValueError(
                f'This chat already contains the maximum of {CANVAS_MAX_DOCUMENT_COUNT} '
                'Canvas documents. Edit an existing document, save work to Notes, or start a new chat.'
            )
        documents[canvas_id] = document
        chat_data[CANVAS_DOCUMENTS_KEY] = documents
        return set_active_canvas_document(chat_data, canvas_id), len(documents)

    try:
        document_count = await _mutate_artifact_chat(chat, mutate, 'Canvas')
    except (RuntimeError, ValueError) as exc:
        return _canvas_tool_error(str(exc))
    return _canvas_tool_document(document, build_canvas_capacity_notice(document_count))


async def canvas_update_document(
    canvas_id: str,
    content: str,
    expected_updated_at: int | None = None,
    expected_content_hash: str = '',
    title: str | None = None,
    __request__: Request = None,
    __chat_id__: str | None = None,
    __user__: dict | None = None,
    __metadata__: dict | None = None,
) -> str:
    """Replace the complete content of an existing Canvas document in this chat.

    Use the canvasId returned by a previous Canvas tool call. This updates that
    same document rather than creating another one. Supply the complete updated
    Markdown in the content argument.

    :param canvas_id: Stable ID of the Canvas document to update.
    :param content: Complete Markdown content after the requested edit.
    :param expected_updated_at: Required updatedAt from the current Canvas reference or read result.
    :param expected_content_hash: Required contentHash from the current Canvas reference or read result.
    :param title: Optional replacement title. Omit it to keep the current title.
    :return: A compact reference to the updated Canvas document.
    """
    chat = await _get_artifact_chat(__chat_id__, __user__)
    if chat is None:
        return _canvas_tool_error('Canvas is available only in a saved chat.')

    focus = (__metadata__ or {}).get('workspace_focus')
    if isinstance(focus, dict) and 'selection' in focus:
        return _canvas_tool_error('A selection edit must use canvas_replace_text, not replace the document.')

    async def mutate(chat_data: dict, session):
        documents = dict(chat_data.get(CANVAS_DOCUMENTS_KEY) or {})
        current = documents.get(canvas_id)
        if not current:
            raise ValueError('Canvas document not found in this chat.')
        updated = build_canvas_document_update(
            canvas_id,
            current,
            content=content,
            title=title,
            expected_updated_at=expected_updated_at,
            expected_content_hash=expected_content_hash,
            source='ai',
        )
        sync = await sync_linked_canvas_note_content(
            updated.get('note_id'),
            (__user__ or {}).get('id', ''),
            updated['content'],
            db=session,
            title=updated['title'],
            commit=False,
        )
        if sync.stale_link:
            updated['note_id'] = None
        documents[canvas_id] = updated
        chat_data[CANVAS_DOCUMENTS_KEY] = documents
        return chat_data, {'document': updated, 'note': sync.note}

    try:
        result = await _mutate_artifact_chat(chat, mutate, 'Canvas')
    except CanvasConflictError as exc:
        return _canvas_tool_conflict(exc)
    except (RuntimeError, ValueError) as exc:
        return _canvas_tool_error(str(exc))
    document = result['document']
    updated_note = result['note']
    if updated_note and __request__ is not None:
        try:
            await _emit_note_updated(__request__, __user__, updated_note)
        except Exception:
            log.exception('Unable to publish linked Canvas Note event canvas_id=%s', canvas_id)

    return _canvas_tool_document(document)


async def canvas_select_document(
    canvas_id: str,
    __chat_id__: str | None = None,
    __user__: dict | None = None,
) -> str:
    """Open an existing Canvas document from this chat.

    :param canvas_id: Stable ID of the Canvas document to open.
    :return: The selected Canvas document.
    """
    chat = await _get_artifact_chat(__chat_id__, __user__)
    if chat is None:
        return _canvas_tool_error('Canvas is available only in a saved chat.')

    async def mutate(chat_data: dict, session):
        documents = dict(chat_data.get(CANVAS_DOCUMENTS_KEY) or {})
        document = documents.get(canvas_id)
        if not document:
            raise ValueError('Canvas document not found in this chat.')
        if document.get('note_id') and not await linked_canvas_note_exists(
            document.get('note_id'),
            (__user__ or {}).get('id', ''),
            db=session,
        ):
            document = {
                **document,
                'note_id': None,
                'updated_at': canvas_timestamp(document.get('updated_at')),
            }
            documents[canvas_id] = document
            chat_data[CANVAS_DOCUMENTS_KEY] = documents
        return set_active_canvas_document(chat_data, canvas_id), document

    try:
        document = await _mutate_artifact_chat(chat, mutate, 'Canvas')
    except (RuntimeError, ValueError) as exc:
        return _canvas_tool_error(str(exc))
    return _canvas_tool_document(document)


async def canvas_list_documents(
    __chat_id__: str | None = None,
    __user__: dict | None = None,
) -> str:
    """List the transient Canvas documents available in this chat.

    :return: Canvas IDs, titles, and update times for this chat.
    """
    chat = await _get_artifact_chat(__chat_id__, __user__)
    if chat is None:
        return _canvas_tool_error('Canvas is available only in a saved chat.')

    documents = (chat.chat or {}).get(CANVAS_DOCUMENTS_KEY) or {}
    warning = build_canvas_capacity_notice(len(documents))
    return json.dumps(
        {
            'type': 'canvas.documents',
            'documentCount': len(documents),
            'maxDocuments': CANVAS_MAX_DOCUMENT_COUNT,
            **({'warning': warning} if warning else {}),
            'documents': [
                {
                    'canvasId': document['canvas_id'],
                    'title': document.get('title', ''),
                    'updatedAt': int(document.get('updated_at') or 0),
                    'selected': document['canvas_id'] == (chat.chat or {}).get(CANVAS_ACTIVE_DOCUMENT_KEY),
                }
                for document in documents.values()
            ],
        },
        ensure_ascii=False,
    )


async def canvas_read_document(
    canvas_id: str,
    start_line: int = 1,
    end_line: int = 200,
    query: str = '',
    __chat_id__: str | None = None,
    __user__: dict | None = None,
) -> str:
    """Read a bounded excerpt of a Canvas without loading the complete document.

    Use query to locate a passage, or start_line/end_line for a precise range.

    :param canvas_id: Stable Canvas document ID.
    :param start_line: First line to return when query is empty.
    :param end_line: Last line to return; at most 400 lines are returned.
    :param query: Optional exact text fragment used to locate a relevant range.
    :return: A line-addressed Canvas excerpt and current update version.
    """
    chat = await _get_artifact_chat(__chat_id__, __user__)
    if chat is None:
        return _canvas_tool_error('Canvas is available only in a saved chat.')
    document = ((chat.chat or {}).get(CANVAS_DOCUMENTS_KEY) or {}).get(canvas_id)
    if not document:
        return _canvas_tool_error('Canvas document not found in this chat.')
    try:
        excerpt = _text_excerpt(document.get('content', ''), start_line, end_line, query)
    except ValueError as exc:
        return _canvas_tool_error(str(exc))
    return json.dumps(
        {
            'type': 'canvas.document_excerpt',
            'canvasId': canvas_id,
            'title': document.get('title', ''),
            'updatedAt': int(document.get('updated_at') or 0),
            'contentHash': _content_hash(document.get('content', '')),
            **excerpt,
        },
        ensure_ascii=False,
    )


async def canvas_replace_text(
    canvas_id: str,
    old_text: str,
    new_text: str,
    expected_content_hash: str,
    expected_updated_at: int | None = None,
    __request__: Request = None,
    __chat_id__: str | None = None,
    __user__: dict | None = None,
    __metadata__: dict | None = None,
) -> str:
    """Replace one uniquely matching passage in a Canvas document.

    Prefer this over canvas_update_document when only part of a large document
    is visible. Read the passage first and pass its updatedAt as the expected
    version so manual edits cannot be overwritten.

    :param canvas_id: Stable Canvas document ID.
    :param old_text: Exact existing passage. It must occur exactly once.
    :param new_text: Replacement passage.
    :param expected_content_hash: Required content hash returned by canvas_read_document.
    :param expected_updated_at: Optional timestamp returned by canvas_read_document.
    :return: The updated Canvas document.
    """
    chat = await _get_artifact_chat(__chat_id__, __user__)
    if chat is None:
        return _canvas_tool_error('Canvas is available only in a saved chat.')
    if not old_text:
        return _canvas_tool_error('old_text must not be empty.')

    raw_focus = (__metadata__ or {}).get('workspace_focus')
    if isinstance(raw_focus, dict) and 'selection' in raw_focus:
        from open_webui.utils.workspace_context import normalize_workspace_focus

        focus = normalize_workspace_focus(raw_focus)
        if (
            not focus
            or focus['id'] != canvas_id
            or focus['selection']['text'] != old_text
            or focus['selection']['contentHash'] != expected_content_hash
        ):
            return _canvas_tool_error(
                'Edit only the original selection using its original document ID and contentHash.'
            )

    async def mutate(chat_data: dict, session):
        documents = dict(chat_data.get(CANVAS_DOCUMENTS_KEY) or {})
        current = documents.get(canvas_id)
        if not current:
            raise ValueError('Canvas document not found in this chat.')
        if expected_updated_at is not None and int(current.get('updated_at') or 0) != expected_updated_at:
            raise ValueError('Canvas changed after it was read. Read the passage again before editing.')
        content = current.get('content', '')
        if _content_hash(content) != expected_content_hash:
            raise ValueError('Canvas changed after it was read. Read the passage again before editing.')
        occurrences = content.count(old_text)
        if occurrences != 1:
            raise ValueError(f'Expected one exact passage match, found {occurrences}. Read a more specific range.')
        updated_content = content.replace(old_text, new_text, 1)
        updated = build_canvas_document_update(
            canvas_id,
            current,
            content=updated_content,
            expected_updated_at=int(current.get('updated_at') or 0),
            expected_content_hash=expected_content_hash,
            source='ai',
        )
        sync = await sync_linked_canvas_note_content(
            updated.get('note_id'),
            (__user__ or {}).get('id', ''),
            updated['content'],
            db=session,
            title=updated['title'],
            commit=False,
        )
        if sync.stale_link:
            updated['note_id'] = None
        documents[canvas_id] = updated
        chat_data[CANVAS_DOCUMENTS_KEY] = documents
        return chat_data, {'document': updated, 'note': sync.note}

    try:
        result = await _mutate_artifact_chat(chat, mutate, 'Canvas')
    except (RuntimeError, ValueError) as exc:
        return _canvas_tool_error(str(exc))

    document = result['document']
    updated_note = result['note']
    if updated_note and __request__ is not None:
        try:
            await _emit_note_updated(__request__, __user__, updated_note)
        except Exception:
            log.exception('Unable to publish linked Canvas Note event canvas_id=%s', canvas_id)
    return _canvas_tool_document(document)


# =============================================================================
# CHAT WEB PREVIEW TOOLS
# =============================================================================


def _web_preview_error(message: str) -> str:
    return json.dumps({'type': 'web_preview.error', 'message': message}, ensure_ascii=False)


def _web_preview_conflict(exc: WebPreviewConflictError) -> str:
    return json.dumps(exc.payload, ensure_ascii=False)


def _web_preview_document(document: dict, warning: str = '') -> str:
    return json.dumps(
        {
            'type': 'web_preview.document',
            'previewId': document['preview_id'],
            'title': document.get('title', ''),
            'entrypoint': document.get('entrypoint', 'index.html'),
            'updatedAt': int(document.get('updated_at') or 0),
            'contentHash': web_preview_content_hash(document),
            'exportedPath': document.get('exported_path'),
            'exportedRuntime': document.get('exported_runtime'),
            **({'warning': warning} if warning else {}),
        },
        ensure_ascii=False,
    )


async def web_preview_create(
    files: dict[str, str],
    title: str = '',
    entrypoint: str = 'index.html',
    __chat_id__: str | None = None,
    __user__: dict | None = None,
) -> str:
    """Create a browser-native Web Preview attached to this chat.

    Use this for HTML, CSS, and JavaScript experiences that run directly in a browser without
    a package install, build step, shell, or server. Supply every file required by the preview.

    :param files: Complete mapping of relative file paths to text contents.
    :param title: Optional short title. Leave empty to derive it from the HTML.
    :param entrypoint: HTML file displayed first, normally index.html.
    :return: The Web Preview with its stable previewId.
    """
    chat = await _get_artifact_chat(__chat_id__, __user__)
    if chat is None:
        return _web_preview_error('Web Preview is available only in a saved chat.')

    try:
        normalized_files = normalize_web_preview_files(files)
    except ValueError as exc:
        return _web_preview_error(str(exc))
    if entrypoint not in normalized_files or normalized_files[entrypoint]['mime'] != 'text/html':
        return _web_preview_error('The entrypoint must reference an HTML file in the preview package.')

    now = web_preview_timestamp()
    preview_id = f'preview-{uuid.uuid4()}'
    document = {
        'preview_id': preview_id,
        'title': generate_web_preview_title(normalized_files, entrypoint, title),
        'entrypoint': entrypoint,
        'files': normalized_files,
        'created_at': now,
        'updated_at': now,
        'exported_path': None,
        'exported_runtime': None,
    }

    def mutate(chat_data: dict, _session):
        documents = dict(chat_data.get(WEB_PREVIEW_DOCUMENTS_KEY) or {})
        if len(documents) >= WEB_PREVIEW_MAX_DOCUMENT_COUNT:
            raise ValueError(
                f'This chat already contains the maximum of {WEB_PREVIEW_MAX_DOCUMENT_COUNT} Web Previews.'
            )
        documents[preview_id] = document
        chat_data[WEB_PREVIEW_DOCUMENTS_KEY] = documents
        return set_active_web_preview(chat_data, preview_id), len(documents)

    try:
        document_count = await _mutate_artifact_chat(chat, mutate, 'Web Preview')
    except (RuntimeError, ValueError) as exc:
        return _web_preview_error(str(exc))
    return _web_preview_document(document, build_web_preview_capacity_notice(document_count))


async def web_preview_update(
    preview_id: str,
    files: dict[str, str],
    expected_updated_at: int | None = None,
    expected_content_hash: str = '',
    title: str | None = None,
    entrypoint: str | None = None,
    __chat_id__: str | None = None,
    __user__: dict | None = None,
) -> str:
    """Replace the complete file package of an existing Web Preview.

    :param preview_id: Stable ID returned by web_preview_create or web_preview_list.
    :param files: Complete mapping of relative file paths to updated text contents.
    :param expected_updated_at: Required updatedAt from the current Web Preview reference or read result.
    :param expected_content_hash: Required whole-preview contentHash from the current Web Preview reference.
    :param title: Optional replacement title. Omit to retain the current title.
    :param entrypoint: Optional replacement HTML entrypoint.
    :return: The updated Web Preview.
    """
    chat = await _get_artifact_chat(__chat_id__, __user__)
    if chat is None:
        return _web_preview_error('Web Preview is available only in a saved chat.')

    def mutate(chat_data: dict, _session):
        documents = dict(chat_data.get(WEB_PREVIEW_DOCUMENTS_KEY) or {})
        current = documents.get(preview_id)
        if not current:
            raise ValueError('Web Preview not found in this chat.')
        updated = build_web_preview_document_update(
            preview_id,
            current,
            files=files,
            title=title,
            entrypoint=entrypoint,
            expected_updated_at=expected_updated_at,
            expected_content_hash=expected_content_hash,
        )
        documents[preview_id] = updated
        chat_data[WEB_PREVIEW_DOCUMENTS_KEY] = documents
        return chat_data, updated

    try:
        document = await _mutate_artifact_chat(chat, mutate, 'Web Preview')
    except WebPreviewConflictError as exc:
        return _web_preview_conflict(exc)
    except (RuntimeError, ValueError) as exc:
        return _web_preview_error(str(exc))
    return _web_preview_document(document)


async def web_preview_select(
    preview_id: str,
    __chat_id__: str | None = None,
    __user__: dict | None = None,
) -> str:
    """Select an existing Web Preview in this chat.

    :param preview_id: Stable ID of the Web Preview to select.
    :return: The selected Web Preview.
    """
    chat = await _get_artifact_chat(__chat_id__, __user__)
    if chat is None:
        return _web_preview_error('Web Preview is available only in a saved chat.')

    def mutate(chat_data: dict, _session):
        document = (chat_data.get(WEB_PREVIEW_DOCUMENTS_KEY) or {}).get(preview_id)
        if not document:
            raise ValueError('Web Preview not found in this chat.')
        return set_active_web_preview(chat_data, preview_id), document

    try:
        document = await _mutate_artifact_chat(chat, mutate, 'Web Preview')
    except (RuntimeError, ValueError) as exc:
        return _web_preview_error(str(exc))
    return _web_preview_document(document)


async def web_preview_list(
    __chat_id__: str | None = None,
    __user__: dict | None = None,
) -> str:
    """List the Web Previews attached to this chat."""
    chat = await _get_artifact_chat(__chat_id__, __user__)
    if chat is None:
        return _web_preview_error('Web Preview is available only in a saved chat.')
    documents = (chat.chat or {}).get(WEB_PREVIEW_DOCUMENTS_KEY) or {}
    active_id = (chat.chat or {}).get(WEB_PREVIEW_ACTIVE_DOCUMENT_KEY)
    return json.dumps(
        {
            'type': 'web_preview.documents',
            'documentCount': len(documents),
            'maxDocuments': WEB_PREVIEW_MAX_DOCUMENT_COUNT,
            **(
                {'warning': build_web_preview_capacity_notice(len(documents))}
                if build_web_preview_capacity_notice(len(documents))
                else {}
            ),
            'documents': [
                {
                    'previewId': document['preview_id'],
                    'title': document.get('title', ''),
                    'entrypoint': document.get('entrypoint', 'index.html'),
                    'updatedAt': int(document.get('updated_at') or 0),
                    'selected': document['preview_id'] == active_id,
                }
                for document in documents.values()
            ],
        },
        ensure_ascii=False,
    )


async def web_preview_read_file(
    preview_id: str,
    path: str,
    start_line: int = 1,
    end_line: int = 200,
    query: str = '',
    __chat_id__: str | None = None,
    __user__: dict | None = None,
) -> str:
    """Read a bounded line-addressed excerpt from one Web Preview file.

    :param preview_id: Stable Web Preview ID.
    :param path: Exact relative file path in the preview package.
    :param start_line: First line to return when query is empty.
    :param end_line: Last line to return; at most 400 lines are returned.
    :param query: Optional exact text fragment used to locate a relevant range.
    :return: A file excerpt with its ``contentHash`` and the whole preview's ``previewContentHash``.
    """
    chat = await _get_artifact_chat(__chat_id__, __user__)
    if chat is None:
        return _web_preview_error('Web Preview is available only in a saved chat.')
    document = ((chat.chat or {}).get(WEB_PREVIEW_DOCUMENTS_KEY) or {}).get(preview_id)
    if not document:
        return _web_preview_error('Web Preview not found in this chat.')
    file = (document.get('files') or {}).get(path)
    if not isinstance(file, dict):
        return _web_preview_error('File not found in this Web Preview.')
    try:
        excerpt = _text_excerpt(file.get('content', ''), start_line, end_line, query)
    except ValueError as exc:
        return _web_preview_error(str(exc))
    return json.dumps(
        {
            'type': 'web_preview.file_excerpt',
            'previewId': preview_id,
            'title': document.get('title', ''),
            'path': path,
            'mime': file.get('mime', 'text/plain'),
            'updatedAt': int(document.get('updated_at') or 0),
            'contentHash': _content_hash(file.get('content', '')),
            'previewContentHash': web_preview_content_hash(document),
            **excerpt,
        },
        ensure_ascii=False,
    )


async def web_preview_replace_text(
    preview_id: str,
    path: str,
    old_text: str,
    new_text: str,
    expected_content_hash: str,
    expected_updated_at: int | None = None,
    __chat_id__: str | None = None,
    __user__: dict | None = None,
) -> str:
    """Replace one uniquely matching passage in one Web Preview file.

    Read the file first and pass its returned contentHash plus updatedAt to avoid overwriting a newer edit.
    For edits spanning multiple files, prefer web_preview_update with the complete package. If using
    this partial edit repeatedly, read the file again after each successful replacement because the
    preview-wide updatedAt changes for every file.

    :param preview_id: Stable Web Preview ID.
    :param path: Exact relative file path in the preview package.
    :param old_text: Exact existing passage; it must occur exactly once.
    :param new_text: Replacement passage.
    :param expected_content_hash: Required file contentHash returned by web_preview_read_file.
    :param expected_updated_at: Optional timestamp returned by web_preview_read_file.
    :return: The updated Web Preview metadata.
    """
    chat = await _get_artifact_chat(__chat_id__, __user__)
    if chat is None:
        return _web_preview_error('Web Preview is available only in a saved chat.')
    if not old_text:
        return _web_preview_error('old_text must not be empty.')

    def mutate(chat_data: dict, _session):
        documents = dict(chat_data.get(WEB_PREVIEW_DOCUMENTS_KEY) or {})
        current = documents.get(preview_id)
        if not current:
            raise ValueError('Web Preview not found in this chat.')
        if expected_updated_at is not None and int(current.get('updated_at') or 0) != expected_updated_at:
            raise ValueError('Web Preview changed after it was read. Read the file again before editing.')
        files = dict(current.get('files') or {})
        file = files.get(path)
        if not isinstance(file, dict):
            raise ValueError('File not found in this Web Preview.')
        content = str(file.get('content', ''))
        if _content_hash(content) != expected_content_hash:
            raise ValueError('Web Preview changed after it was read. Read the file again before editing.')
        occurrences = content.count(old_text)
        if occurrences != 1:
            raise ValueError(f'Expected one exact passage match, found {occurrences}. Read a more specific range.')
        files[path] = {**file, 'content': content.replace(old_text, new_text, 1)}
        updated = build_web_preview_document_update(
            preview_id,
            current,
            files=files,
            expected_updated_at=int(current.get('updated_at') or 0),
            expected_content_hash=web_preview_content_hash(current),
        )
        documents[preview_id] = updated
        chat_data[WEB_PREVIEW_DOCUMENTS_KEY] = documents
        return chat_data, updated

    try:
        document = await _mutate_artifact_chat(chat, mutate, 'Web Preview')
    except (RuntimeError, ValueError) as exc:
        return _web_preview_error(str(exc))
    return _web_preview_document(document)


async def web_preview_import_runtime_file(
    preview_id: str,
    source_path: str,
    expected_updated_at: int,
    expected_content_hash: str,
    target_path: str = '',
    __event_call__: callable = None,
    __metadata__: dict | None = None,
    __chat_id__: str | None = None,
    __user__: dict | None = None,
) -> str:
    """Copy one text file from the active runtime into an existing Web Preview.

    Use this after code execution creates or transforms data that the
    Web Preview should display. The imported file is a snapshot: the preview remains usable if
    the runtime later stops or the source file changes.

    :param preview_id: Stable Web Preview ID receiving the file.
    :param source_path: Absolute path to a text file in the active Pyodide workspace.
    :param expected_updated_at: Required updatedAt from the current Web Preview reference.
    :param expected_content_hash: Required whole-preview previewContentHash from web_preview_read_file or contentHash from a preview reference.
    :param target_path: Optional relative path inside the preview, for example data/results.json.
    :return: The updated Web Preview metadata.
    """
    chat = await _get_artifact_chat(__chat_id__, __user__)
    if chat is None:
        return _web_preview_error('Web Preview is available only in a saved chat.')
    if __event_call__ is None:
        return _web_preview_error('The active runtime is not connected to this chat.')

    source_path = str(source_path or '').strip()
    parsed_source_path = PurePosixPath(source_path)
    if (
        not source_path.startswith('/mnt/uploads/')
        or '\x00' in source_path
        or len(source_path) > 1_024
        or '..' in parsed_source_path.parts
        or str(parsed_source_path) != source_path
    ):
        return _web_preview_error('source_path must be a canonical Pyodide uploads path.')
    source_name = parsed_source_path.name
    if not source_name:
        return _web_preview_error('source_path must reference a file.')
    target_path = str(target_path or f'data/{source_name}')
    try:
        target_path = next(iter(normalize_web_preview_files({target_path: ''})))
    except ValueError as exc:
        return _web_preview_error(str(exc))

    current = ((chat.chat or {}).get(WEB_PREVIEW_DOCUMENTS_KEY) or {}).get(preview_id)
    if not current:
        return _web_preview_error('Web Preview not found in this chat.')
    try:
        require_web_preview_precondition(
            preview_id,
            current,
            expected_updated_at,
            expected_content_hash,
        )
    except WebPreviewConflictError as exc:
        return _web_preview_conflict(exc)

    metadata = __metadata__ or {}
    response = await __event_call__(
        {
            'type': 'workspace:read_runtime_file',
            'data': {
                'id': str(uuid.uuid4()),
                'runtime': 'pyodide',
                'chat_id': __chat_id__,
                'source_path': source_path,
                'max_bytes': WEB_PREVIEW_RUNTIME_IMPORT_MAX_BYTES,
                'session_id': metadata.get('session_id'),
            },
        }
    )
    if not isinstance(response, dict) or response.get('error'):
        message = response.get('error') if isinstance(response, dict) else None
        return _web_preview_error(message or 'The runtime file could not be read.')
    content = response.get('content')
    if not isinstance(content, str):
        return _web_preview_error('Only UTF-8 text files can be imported into a Web Preview.')
    if len(content.encode('utf-8')) > WEB_PREVIEW_RUNTIME_IMPORT_MAX_BYTES:
        return _web_preview_error('The runtime file is too large to import into a Web Preview.')

    def mutate(chat_data: dict, _session):
        documents = dict(chat_data.get(WEB_PREVIEW_DOCUMENTS_KEY) or {})
        current = documents.get(preview_id)
        if not current:
            raise ValueError('Web Preview not found in this chat.')
        files = dict(current.get('files') or {})
        files[target_path] = {'content': content}
        updated = build_web_preview_document_update(
            preview_id,
            current,
            files=files,
            expected_updated_at=expected_updated_at,
            expected_content_hash=expected_content_hash,
        )
        documents[preview_id] = updated
        chat_data[WEB_PREVIEW_DOCUMENTS_KEY] = documents
        return chat_data, updated

    try:
        document = await _mutate_artifact_chat(chat, mutate, 'Web Preview')
    except WebPreviewConflictError as exc:
        return _web_preview_conflict(exc)
    except (RuntimeError, ValueError) as exc:
        return _web_preview_error(str(exc))
    return _web_preview_document(document)


async def workspace_display_file(
    path: str,
    __event_call__: callable = None,
    __metadata__: dict = None,
    __chat_id__: str = None,
    __user__: dict = None,
) -> str:
    """Open a generated document from this chat in the user's workspace viewer.

    Call after execute_code finishes, when a PDF, Word, PowerPoint, spreadsheet or CSV
    is ready to show. Do not open intermediate files. This does not create or save files.

    :param path: Exact /mnt/uploads/ path of a generated PDF, DOCX, PPTX, XLS, XLSX or CSV.
    :return: Whether opening was requested, or an error if unavailable.
    """
    from open_webui.env import ENABLE_DOCUMENT_VIEWER
    from open_webui.utils.canvas import is_internal_note_chat
    from open_webui.utils.access_control import has_permission
    from open_webui.utils.workspace_outputs import normalize_workspace_output

    chat = await _get_artifact_chat(__chat_id__, __user__)
    if chat is None or is_internal_note_chat(chat):
        return JSONCodec.dumps({'error': 'A saved, owner-visible chat is required.'})
    if (
        not ENABLE_DOCUMENT_VIEWER
        or not await Config.get('code_interpreter.enable', False)
        or await Config.get('code_interpreter.engine', 'pyodide') != 'pyodide'
    ):
        return JSONCodec.dumps({'error': 'Pyodide document display is disabled.'})
    if (__user__ or {}).get('role') != 'admin' and not await has_permission(
        (__user__ or {}).get('id', ''), 'features.code_interpreter', await Config.get('user.permissions')
    ):
        return JSONCodec.dumps({'error': 'Code Interpreter permission is required.'})
    if not normalize_workspace_output({'path': path}):
        return JSONCodec.dumps({'error': 'Invalid document path.'})
    if PurePosixPath(path).suffix.lower() not in {'.pdf', '.docx', '.pptx', '.xls', '.xlsx', '.csv'}:
        return JSONCodec.dumps({'error': 'This format is download-only. Use an output link instead.'})
    if __event_call__ is None or not (__metadata__ or {}).get('session_id'):
        return JSONCodec.dumps({'error': 'An interactive browser session is required.'})
    try:
        result = await __event_call__(
            {
                'type': 'workspace:display_file',
                'data': {'path': path, 'session_id': __metadata__['session_id']},
            }
        )
        if not isinstance(result, dict) or result.get('status') != 'opening':
            return JSONCodec.dumps(
                {
                    'error': (result or {}).get('error', 'Document could not be opened.')
                    if isinstance(result, dict)
                    else 'Document could not be opened.'
                }
            )
        return JSONCodec.dumps({'status': 'opening', 'path': path})
    except Exception:
        log.exception('Workspace document display failed')
        return JSONCodec.dumps({'error': 'The browser did not confirm the display request.'})
