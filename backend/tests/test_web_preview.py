import asyncio
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock

from starlette.requests import Request

from open_webui.models.chats import Chats
from open_webui.models.config import Config
from open_webui.routers.chats import WebPreviewDocumentForm, update_transient_web_preview
from open_webui.tools.builtin import web_preview_create, web_preview_update
from open_webui.utils.tools import get_builtin_tools
from open_webui.utils.web_preview import (
    WEB_PREVIEW_ACTIVE_DOCUMENT_KEY,
    WEB_PREVIEW_DOCUMENTS_KEY,
    build_active_web_preview_prompt,
    generate_web_preview_title,
    normalize_web_preview_files,
    web_preview_timestamp,
)


def test_normalizes_browser_files_and_rejects_path_traversal():
    files = normalize_web_preview_files({'index.html': '<h1>Hello</h1>', 'app.js': 'alert(1)'})
    assert files['index.html']['mime'] == 'text/html'
    assert files['app.js']['mime'] == 'text/javascript'

    try:
        normalize_web_preview_files({'../secret.txt': 'no'})
        assert False, 'unsafe path accepted'
    except ValueError as exc:
        assert 'Unsafe preview file path' in str(exc)


def test_title_and_active_prompt_include_complete_preview_context():
    files = normalize_web_preview_files(
        {'index.html': '<html><head><title>Trip planner</title></head></html>', 'app.js': 'start()'}
    )
    assert generate_web_preview_title(files) == 'Trip planner'

    prompt = build_active_web_preview_prompt(
        {
            WEB_PREVIEW_ACTIVE_DOCUMENT_KEY: 'preview-1',
            WEB_PREVIEW_DOCUMENTS_KEY: {
                'preview-1': {
                    'preview_id': 'preview-1',
                    'title': 'Trip planner',
                    'entrypoint': 'index.html',
                    'files': files,
                }
            },
        }
    )
    assert 'preview_id: preview-1' in prompt
    assert '<file path="index.html">' in prompt
    assert 'web_preview_update' in prompt


def test_preview_timestamps_always_advance():
    current = web_preview_timestamp()
    assert web_preview_timestamp(current) > current


def test_canvas_and_web_preview_are_independent_model_tools(monkeypatch):
    chat_id = '9e2ea702-0b76-42b9-9e0e-4f804a4f8851'
    chat = SimpleNamespace(id=chat_id, meta={})
    categories = {
        'automations',
        'calendar',
        'canvas',
        'channels',
        'chats',
        'code_interpreter',
        'files',
        'image_generation',
        'knowledge',
        'memory',
        'notes',
        'notifications',
        'subagents',
        'tasks',
        'time',
        'web_preview',
        'web_search',
    }

    monkeypatch.setattr(Chats, 'get_chat_by_id', AsyncMock(return_value=chat))
    monkeypatch.setattr(Config, 'get_many', AsyncMock(return_value={}))

    async def tool_names(capability):
        builtin_tools = {category: False for category in categories}
        builtin_tools[capability] = True
        tools = await get_builtin_tools(
            Request({'type': 'http', 'method': 'POST', 'path': '/'}),
            {
                '__user__': {'id': 'user-1', 'role': 'user'},
                '__metadata__': {'chat_id': chat_id},
            },
            model={
                'info': {
                    'meta': {
                        'builtinTools': builtin_tools,
                        'capabilities': {capability: True},
                    }
                }
            },
        )
        return set(tools)

    preview_tools = asyncio.run(tool_names('web_preview'))
    canvas_tools = asyncio.run(tool_names('canvas'))

    assert preview_tools == {
        'web_preview_create',
        'web_preview_update',
        'web_preview_select',
        'web_preview_list',
    }
    assert canvas_tools == {
        'canvas_create_document',
        'canvas_update_document',
        'canvas_select_document',
        'canvas_list_documents',
    }


def test_create_then_update_reuses_stable_preview_id(monkeypatch):
    chat = SimpleNamespace(id='chat-1', user_id='user-1', chat={})

    async def save_chat(_id, data):
        chat.chat = data

    monkeypatch.setattr(Chats, 'get_chat_by_id', AsyncMock(return_value=chat))
    monkeypatch.setattr(Chats, 'update_chat_by_id', save_chat)

    created = json.loads(
        asyncio.run(
            web_preview_create(
                {'index.html': '<title>Counter</title><h1>One</h1>'},
                __chat_id__=chat.id,
                __user__={'id': 'user-1'},
            )
        )
    )
    preview_id = created['previewId']
    assert chat.chat[WEB_PREVIEW_ACTIVE_DOCUMENT_KEY] == preview_id

    updated = json.loads(
        asyncio.run(
            web_preview_update(
                preview_id,
                {'index.html': '<title>Counter</title><h1>Two</h1>', 'app.js': 'boot()'},
                __chat_id__=chat.id,
                __user__={'id': 'user-1'},
            )
        )
    )
    assert updated['previewId'] == preview_id
    assert len(chat.chat[WEB_PREVIEW_DOCUMENTS_KEY]) == 1
    assert updated['files']['app.js']['content'] == 'boot()'


def test_direct_editor_autosaves_keep_the_latest_revision(monkeypatch):
    preview_id = 'preview-1'
    chat = SimpleNamespace(
        id='chat-1',
        user_id='user-1',
        chat={
            WEB_PREVIEW_DOCUMENTS_KEY: {
                preview_id: {
                    'preview_id': preview_id,
                    'title': 'Counter',
                    'entrypoint': 'index.html',
                    'files': normalize_web_preview_files({'index.html': '<h1>Zero</h1>'}),
                    'updated_at': 1,
                }
            }
        },
    )

    async def save_chat(_id, data, db=None, touch=False):
        chat.chat = data

    monkeypatch.setattr(Chats, 'get_chat_by_id_and_user_id', AsyncMock(return_value=chat))
    monkeypatch.setattr(Chats, 'update_chat_by_id', save_chat)

    async def save(content):
        return await update_transient_web_preview(
            chat.id,
            preview_id,
            WebPreviewDocumentForm(
                title='Counter',
                files={'index.html': {'content': content, 'mime': 'text/html'}},
            ),
            user=SimpleNamespace(id='user-1'),
            db=object(),
        )

    first = asyncio.run(save('<h1>One</h1>'))
    second = asyncio.run(save('<h1>Two</h1>'))

    assert second['updated_at'] > first['updated_at']
    assert chat.chat[WEB_PREVIEW_DOCUMENTS_KEY][preview_id]['files']['index.html']['content'] == '<h1>Two</h1>'
