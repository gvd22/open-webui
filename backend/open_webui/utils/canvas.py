"""Shared state helpers for chat-scoped Canvas documents."""

from __future__ import annotations

from open_webui.models.chats import Chats
from open_webui.utils.chat_id import is_saved_chat_id

CANVAS_DOCUMENTS_KEY = '_canvas_documents'
CANVAS_ACTIVE_DOCUMENT_KEY = '_canvas_active_document_id'
CANVAS_WARNING_DOCUMENT_COUNT = 10
CANVAS_MAX_DOCUMENT_COUNT = 15

_GENERIC_CANVAS_TITLES = {
    'canvas',
    'dokument',
    'draft',
    'entwurf',
    'neuer entwurf',
    'notiz',
    'projekt-notiz',
    'projekt notiz',
    'project note',
    'untitled',
}


def generate_canvas_title(content: str = '', fallback: str = '') -> str:
    """Derive a concise stable title when a Canvas has not been named by its user."""

    def clean(value: str) -> str:
        stripped = (
            value.replace('`', '')
            .replace('*', '')
            .replace('_', '')
            .replace('#', '')
            .replace('>', '')
            .replace('[', '')
            .replace(']', '')
            .strip()
            .removeprefix('- ')
            .removeprefix('+ ')
        )
        return ' '.join(stripped.split())

    def truncate(value: str) -> str:
        return f'{value[:45].rstrip()}...' if len(value) > 48 else value

    fallback_title = clean(fallback)
    if fallback_title and fallback_title.lower() not in _GENERIC_CANVAS_TITLES:
        return truncate(fallback_title)

    lines = [clean(line) for line in content.splitlines()]
    headings = [
        clean(line.lstrip()[1:].lstrip())
        for line in content.splitlines()
        if line.lstrip().startswith('#')
    ]
    heading = next(
        (candidate for candidate in headings if candidate),
        '',
    )
    non_empty = [line for line in lines if line]
    sentence = (
        heading
        or next((line for line in non_empty if len(line) >= 18 and line not in {'Projekt', 'Status', 'Notiz'}), '')
        or next((line for line in non_empty if len(line) >= 8), '')
        or (non_empty[0] if non_empty else '')
        or fallback_title
        or 'Neuer Entwurf'
    )
    return truncate(clean(sentence))


def canvas_document_limit_reached(document_count: int) -> bool:
    return document_count >= CANVAS_MAX_DOCUMENT_COUNT


def is_internal_note_chat(chat) -> bool:
    """Notes use their own persistent editor and must not create chat Canvas documents."""
    meta = getattr(chat, 'meta', None) or {}
    return meta.get('internal') is True and meta.get('type') == 'note'


def build_canvas_capacity_notice(document_count: int) -> str:
    """Describe remaining Canvas capacity after reaching the warning threshold."""
    if document_count < CANVAS_WARNING_DOCUMENT_COUNT:
        return ''

    remaining = max(CANVAS_MAX_DOCUMENT_COUNT - document_count, 0)
    if remaining == 0:
        return (
            f'This chat now contains {CANVAS_MAX_DOCUMENT_COUNT} Canvas documents, '
            'the maximum. Existing documents can still be edited or saved to Notes.'
        )

    return (
        f'This chat contains {document_count} Canvas documents. '
        f'You can create {remaining} more before reaching the limit.'
    )


def build_canvas_note_content(markdown: str, html: str | None = None, json: dict | None = None) -> dict:
    """Keep Markdown authoritative when the editor has not produced HTML yet."""
    return {
        'md': markdown,
        'html': html or '',
        'json': json,
    }


async def sync_linked_canvas_note_content(
    note_id: str | None,
    user_id: str,
    markdown: str,
    db=None,
):
    """Mirror a Canvas tool update to its explicitly linked Note.

    Canvas remains the chat-scoped working context. Once a user explicitly adds
    it to Notes, both surfaces represent the same document, so model updates
    must update the linked Note as well. The Note title stays user-controlled.
    """
    if not note_id:
        return None

    from open_webui.models.notes import Notes, NoteUpdateForm

    note = await Notes.get_note_by_id(note_id, db=db)
    if not note or note.user_id != user_id:
        return None

    current_content = (note.data or {}).get('content') or {}
    if current_content.get('md') == markdown:
        return None

    return await Notes.update_note_by_id(
        note_id,
        NoteUpdateForm(
            data={
                **(note.data or {}),
                'content': build_canvas_note_content(markdown),
            }
        ),
        db=db,
    )


def set_active_canvas_document(chat_data: dict, canvas_id: str) -> dict:
    """Return chat data with an existing Canvas document selected."""
    documents = chat_data.get(CANVAS_DOCUMENTS_KEY) or {}
    if canvas_id not in documents:
        return chat_data

    return {**chat_data, CANVAS_ACTIVE_DOCUMENT_KEY: canvas_id}


def build_active_canvas_prompt(chat_data: dict) -> str:
    """Build request-only model context for Canvas documents in the chat."""
    documents = chat_data.get(CANVAS_DOCUMENTS_KEY) or {}
    if not documents:
        return ''

    active_canvas_id = chat_data.get(CANVAS_ACTIVE_DOCUMENT_KEY)
    document = documents.get(active_canvas_id)
    document_catalog = '\n'.join(
        f"- canvas_id: {canvas_id}; title: {canvas.get('title', '') or 'Untitled'}"
        for canvas_id, canvas in documents.items()
    )

    if not document:
        return f"""[CANVAS DOCUMENTS]
The user has these Canvas documents in this chat:
{document_catalog}

There is no active Canvas document. If the user names one of these documents or asks to
continue one, call canvas_select_document with its canvas_id before updating it."""

    title = document.get('title', '')
    content = document.get('content', '')
    return f"""[CANVAS DOCUMENTS]
The user has these Canvas documents in this chat:
{document_catalog}

[ACTIVE CANVAS DOCUMENT]
The user currently has this Canvas document selected.
canvas_id: {active_canvas_id}
title: {title}

<canvas_markdown>
{content}
</canvas_markdown>

When the user asks to continue, expand, shorten, rewrite, correct, or otherwise change the
selected document, call canvas_update_document with exactly this canvas_id and the complete
updated Markdown. Do not call canvas_create_document unless the user explicitly asks for a
separate or new document. If the user explicitly targets another Canvas document, select that
document first and then update it."""


async def get_active_canvas_prompt(chat_id: str, user_id: str) -> str:
    """Load owner-scoped active Canvas context for one completion request."""
    if not is_saved_chat_id(chat_id):
        return ''

    chat = await Chats.get_chat_by_id(chat_id)
    if not chat or chat.user_id != user_id:
        return ''

    return build_active_canvas_prompt(chat.chat or {})
