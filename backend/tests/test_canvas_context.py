import asyncio
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock

from starlette.requests import Request

from open_webui.models.chats import Chats
from open_webui.models.notes import Notes
from open_webui.routers.chats import (
    CanvasDocumentForm,
    undo_last_canvas_ai_update,
    update_transient_canvas_document,
)
from open_webui.tools.builtin import canvas_update_document
from open_webui.utils.canvas import (
    CANVAS_ACTIVE_DOCUMENT_KEY,
    CANVAS_DOCUMENTS_KEY,
    CANVAS_MAX_DOCUMENT_COUNT,
    CANVAS_WARNING_DOCUMENT_COUNT,
    build_active_canvas_prompt,
    build_canvas_capacity_notice,
    build_canvas_note_content,
    canvas_document_limit_reached,
    generate_canvas_title,
    is_internal_note_chat,
    set_active_canvas_document,
    sync_linked_canvas_note_content,
)


def test_active_canvas_prompt_targets_existing_document_for_updates():
    chat_data = {
        CANVAS_DOCUMENTS_KEY: {
            'canvas-1': {
                'canvas_id': 'canvas-1',
                'title': 'Bananen',
                'content': '# Bananen\n\nKurzer Text',
            }
        }
    }

    selected = set_active_canvas_document(chat_data, 'canvas-1')
    prompt = build_active_canvas_prompt(selected)

    assert selected[CANVAS_ACTIVE_DOCUMENT_KEY] == 'canvas-1'
    assert 'The user has these Canvas documents in this chat:' in prompt
    assert 'canvas_id: canvas-1' in prompt
    assert '# Bananen\n\nKurzer Text' in prompt
    assert 'canvas_update_document' in prompt
    assert 'Do not call canvas_create_document' in prompt


def test_missing_canvas_cannot_become_active():
    chat_data = {CANVAS_DOCUMENTS_KEY: {}}

    selected = set_active_canvas_document(chat_data, 'missing')

    assert CANVAS_ACTIVE_DOCUMENT_KEY not in selected
    assert build_active_canvas_prompt(selected) == ''


def test_canvas_catalog_is_available_without_an_active_document():
    prompt = build_active_canvas_prompt(
        {
            CANVAS_DOCUMENTS_KEY: {
                'canvas-1': {
                    'canvas_id': 'canvas-1',
                    'title': 'Reiseplan',
                    'content': '# Reiseplan',
                }
            }
        }
    )

    assert 'canvas_id: canvas-1; title: Reiseplan' in prompt
    assert 'There is no active Canvas document.' in prompt
    assert 'canvas_select_document' in prompt


def test_canvas_ai_update_retains_one_undo_snapshot(monkeypatch):
    chat = SimpleNamespace(
        id='9e2ea702-0b76-42b9-9e0e-4f804a4f8851',
        user_id='user-1',
        chat={
            CANVAS_DOCUMENTS_KEY: {
                'canvas-1': {
                    'canvas_id': 'canvas-1',
                    'title': 'Reiseplan',
                    'content': '# Reiseplan\n\nAlt',
                    'title_edited': True,
                }
            }
        },
    )
    get_chat = AsyncMock(return_value=chat)

    async def save_chat(_id, data):
        chat.chat = data

    monkeypatch.setattr(Chats, 'get_chat_by_id', get_chat)
    monkeypatch.setattr(Chats, 'update_chat_by_id', save_chat)

    result = json.loads(
        asyncio.run(
            canvas_update_document(
                'canvas-1',
                '# Reiseplan\n\nNeu',
                __chat_id__=chat.id,
                __user__={'id': 'user-1'},
            )
        )
    )

    saved = chat.chat[CANVAS_DOCUMENTS_KEY]['canvas-1']
    assert result['canUndoAiUpdate'] is True
    assert saved['content'] == '# Reiseplan\n\nNeu'
    assert saved['last_ai_update'] == {
        'title': 'Reiseplan',
        'content': '# Reiseplan\n\nAlt',
        'title_edited': True,
    }


def test_manual_canvas_edit_clears_stale_ai_undo(monkeypatch):
    chat = SimpleNamespace(
        id='5a7f82a0-9c61-465e-a1a1-8ad81a1d5fe4',
        user_id='user-1',
        chat={
            CANVAS_DOCUMENTS_KEY: {
                'canvas-1': {
                    'canvas_id': 'canvas-1',
                    'title': 'Reiseplan',
                    'content': '# Reiseplan\n\nKI-Version',
                    'title_edited': True,
                    'last_ai_update': {
                        'title': 'Reiseplan',
                        'content': '# Reiseplan\n\nVorher',
                        'title_edited': True,
                    },
                }
            }
        },
    )

    async def save_chat(_id, data, **_kwargs):
        chat.chat = data

    monkeypatch.setattr(Chats, 'get_chat_by_id_and_user_id', AsyncMock(return_value=chat))
    monkeypatch.setattr(Chats, 'update_chat_by_id', save_chat)

    result = asyncio.run(
        update_transient_canvas_document(
            Request({'type': 'http', 'method': 'POST', 'path': '/'}),
            chat.id,
            'canvas-1',
            CanvasDocumentForm(title='Reiseplan', content='# Reiseplan\n\nEigene Änderung', title_edited=True),
            user=SimpleNamespace(id='user-1'),
        )
    )

    assert result['last_ai_update'] is None
    assert chat.chat[CANVAS_DOCUMENTS_KEY]['canvas-1']['last_ai_update'] is None


def test_undo_route_restores_the_last_ai_snapshot(monkeypatch):
    chat = SimpleNamespace(
        id='d5604748-0b35-423a-8fd6-5c38a1a3a3a3',
        user_id='user-1',
        chat={
            CANVAS_DOCUMENTS_KEY: {
                'canvas-1': {
                    'canvas_id': 'canvas-1',
                    'title': 'Reiseplan',
                    'content': '# Reiseplan\n\nKI-Version',
                    'title_edited': True,
                    'last_ai_update': {
                        'title': 'Reiseplan',
                        'content': '# Reiseplan\n\nVorher',
                        'title_edited': True,
                    },
                }
            }
        },
    )

    async def save_chat(_id, data, **_kwargs):
        chat.chat = data

    monkeypatch.setattr(Chats, 'get_chat_by_id_and_user_id', AsyncMock(return_value=chat))
    monkeypatch.setattr(Chats, 'update_chat_by_id', save_chat)

    result = asyncio.run(
        undo_last_canvas_ai_update(
            Request({'type': 'http', 'method': 'POST', 'path': '/'}),
            chat.id,
            'canvas-1',
            user=SimpleNamespace(id='user-1'),
        )
    )

    assert result['content'] == '# Reiseplan\n\nVorher'
    assert result['last_ai_update'] is None
    assert chat.chat[CANVAS_DOCUMENTS_KEY]['canvas-1']['content'] == '# Reiseplan\n\nVorher'


def test_note_promotion_keeps_markdown_out_of_html_fallback():
    content = build_canvas_note_content('# Bananen\n\nText')

    assert content == {
        'md': '# Bananen\n\nText',
        'html': '',
        'json': None,
    }


def test_canvas_capacity_warns_at_ten_and_caps_at_fifteen():
    assert CANVAS_WARNING_DOCUMENT_COUNT == 10
    assert CANVAS_MAX_DOCUMENT_COUNT == 15
    assert build_canvas_capacity_notice(9) == ''
    assert '5 more' in build_canvas_capacity_notice(10)
    assert 'the maximum' in build_canvas_capacity_notice(15)
    assert canvas_document_limit_reached(14) is False
    assert canvas_document_limit_reached(15) is True


def test_canvas_title_is_derived_from_markdown_unless_user_named_it():
    assert generate_canvas_title('# Tagesausflug Bern\n\n- Anreise') == 'Tagesausflug Bern'
    assert generate_canvas_title('# Neuer Plan', 'Projekt-Notiz') == 'Neuer Plan'
    assert generate_canvas_title('# Neuer Plan', 'Mein eigener Titel') == 'Mein eigener Titel'


def test_canvas_is_not_available_inside_internal_note_chats():
    note_chat = SimpleNamespace(meta={'internal': True, 'type': 'note'})
    automation_chat = SimpleNamespace(meta={'internal': True, 'type': 'automation'})

    assert is_internal_note_chat(note_chat) is True
    assert is_internal_note_chat(automation_chat) is False
    assert is_internal_note_chat(None) is False


def test_linked_note_receives_canvas_content_update(monkeypatch):
    existing_note = SimpleNamespace(
        id='note-1',
        user_id='user-1',
        data={'content': {'md': '# Alt', 'html': '<h1>Alt</h1>', 'json': {}}},
    )
    updated_note = SimpleNamespace(id='note-1')
    get_note = AsyncMock(return_value=existing_note)
    update_note = AsyncMock(return_value=updated_note)
    monkeypatch.setattr(Notes, 'get_note_by_id', get_note)
    monkeypatch.setattr(Notes, 'update_note_by_id', update_note)

    result = asyncio.run(sync_linked_canvas_note_content('note-1', 'user-1', '# Neu\n\nMit Nachtprogramm'))

    assert result is updated_note
    form = update_note.await_args.args[1]
    assert form.data['content'] == {
        'md': '# Neu\n\nMit Nachtprogramm',
        'html': '',
        'json': None,
    }


def test_linked_note_does_not_write_when_canvas_content_is_unchanged(monkeypatch):
    existing_note = SimpleNamespace(
        id='note-1',
        user_id='user-1',
        data={'content': {'md': '# Gleich', 'html': '', 'json': None}},
    )
    get_note = AsyncMock(return_value=existing_note)
    update_note = AsyncMock()
    monkeypatch.setattr(Notes, 'get_note_by_id', get_note)
    monkeypatch.setattr(Notes, 'update_note_by_id', update_note)

    result = asyncio.run(sync_linked_canvas_note_content('note-1', 'user-1', '# Gleich'))

    assert result is None
    update_note.assert_not_awaited()
