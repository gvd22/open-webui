from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock

import open_webui.env as env
import open_webui.utils.tools as tools_utils
import pytest
from fastapi import Request
from open_webui.models.chats import Chats
from open_webui.models.config import Config

CHAT_ID = 'builtin-matrix-chat'

GLOBAL_FLAGS = {
    'web.search.enable': True,
    'image_generation.enable': True,
    'images.edit.enable': True,
    'code_interpreter.enable': True,
    'notes.enable': True,
    'channels.enable': True,
    'automations.enable': True,
    'calendar.enable': True,
    'ui.enable_user_webhooks': True,
    'subagents.enable': True,
    'subagents.background_enabled': True,
    'code_interpreter.engine': 'pyodide',
}

CATEGORY_TO_TOOLS = {
    'time': {'get_current_timestamp', 'calculate_timestamp'},
    'user_input': {'ask_user'},
    'files': {'list_chat_files', 'query_chat_files', 'grep_chat_files', 'view_file'},
    'knowledge': {
        'list_knowledge_bases',
        'search_knowledge_bases',
        'query_knowledge_bases',
        'grep_knowledge_files',
        'search_knowledge_files',
        'query_knowledge_files',
        'view_knowledge_file',
    },
    'chats': {'search_chats', 'view_chat'},
    'subagents': {'delegate_task', 'timer'},
    'memory': {
        'search_memories',
        'list_memory_paths',
        'read_memory_path',
        'list_memories',
        'update_memory',
        'add_memory',
        'replace_memory_content',
        'delete_memory',
    },
    'web_search': {'search_web', 'fetch_url'},
    'image_generation': {'generate_image', 'edit_image'},
    'code_interpreter': {'execute_code'},
    'notes': {'search_notes', 'view_note', 'write_note', 'replace_note_content'},
    'canvas': {
        'canvas_create_document',
        'canvas_update_document',
        'canvas_select_document',
        'canvas_list_documents',
        'canvas_read_document',
        'canvas_replace_text',
    },
    'web_preview': {
        'web_preview_create',
        'web_preview_update',
        'web_preview_select',
        'web_preview_list',
        'web_preview_read_file',
        'web_preview_replace_text',
    },
    'channels': {
        'search_channels',
        'search_channel_messages',
        'view_channel_thread',
        'view_channel_message',
    },
    'tasks': {'create_tasks', 'update_task'},
    'automations': {
        'create_automation',
        'update_automation',
        'list_automations',
        'toggle_automation',
        'delete_automation',
    },
    'calendar': {
        'search_calendar_events',
        'create_calendar_event',
        'update_calendar_event',
        'delete_calendar_event',
    },
    'notifications': {'notify'},
}


def make_request(*, internal: bool = False, direct: bool = False) -> Request:
    request = Request({'type': 'http', 'method': 'POST', 'path': '/'})
    request.state.internal = internal
    request.state.direct = direct
    return request


def model_for(*enabled_categories: str, capabilities: dict[str, bool] | None = None) -> dict:
    builtin_tools = {category: False for category in CATEGORY_TO_TOOLS}
    builtin_tools.update({category: True for category in enabled_categories})
    return {
        'info': {
            'meta': {
                'builtinTools': builtin_tools,
                'capabilities': capabilities or {},
            }
        }
    }


def install_config(monkeypatch, *, flags: dict | None = None, permissions: bool = True, chat=None) -> None:
    values = {**GLOBAL_FLAGS, **(flags or {})}

    async def get_many(*keys):
        return {key: values.get(key) for key in keys}

    async def get(key, default=None):
        if key == 'user.permissions':
            return {}
        return values.get(key, default)

    monkeypatch.setattr(Config, 'get_many', get_many)
    monkeypatch.setattr(Config, 'get', get)
    monkeypatch.setattr(Chats, 'get_chat_by_id', AsyncMock(return_value=chat or SimpleNamespace(meta={})))
    monkeypatch.setattr(tools_utils, 'has_permission', AsyncMock(return_value=permissions))
    monkeypatch.setattr(env, 'ENABLE_KB_EXEC', False)


def extra_params(*, metadata: dict | None = None, user: dict | None = None, skill_ids=None, event_call=None) -> dict:
    return {
        '__user__': user or {'id': 'user-1', 'role': 'admin'},
        '__metadata__': {'chat_id': CHAT_ID, **(metadata or {})},
        '__chat_id__': CHAT_ID,
        '__skill_ids__': skill_ids,
        '__event_call__': event_call,
    }


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ('enabled', 'engine', 'viewer', 'permission', 'capability', 'session', 'expected'),
    [
        (True, 'pyodide', True, True, True, 'session', True),
        (False, 'pyodide', True, True, True, 'session', False),
        (True, 'jupyter', True, True, True, 'session', False),
        (True, 'pyodide', False, True, True, 'session', False),
        (True, 'pyodide', True, False, True, 'session', False),
        (True, 'pyodide', True, True, False, 'session', False),
        (True, 'pyodide', True, True, True, '', False),
    ],
)
async def test_document_display_registration(
    monkeypatch, enabled, engine, viewer, permission, capability, session, expected
):
    install_config(
        monkeypatch,
        flags={'code_interpreter.enable': enabled, 'code_interpreter.engine': engine},
        permissions=permission,
    )
    monkeypatch.setattr(env, 'ENABLE_DOCUMENT_VIEWER', viewer)
    tools = await tools_utils.get_builtin_tools(
        make_request(),
        extra_params(user={'id': 'user-1', 'role': 'user'}, metadata={'session_id': session}),
        features={'code_interpreter': True},
        model=model_for('code_interpreter', capabilities={'code_interpreter': capability}),
    )
    assert ('workspace_display_file' in tools) is expected


@pytest.mark.asyncio
async def test_document_display_validates_owner_permissions_and_browser_ack(monkeypatch):
    import json

    from open_webui.tools import builtin
    from open_webui.utils import access_control

    install_config(monkeypatch, chat=SimpleNamespace(user_id='user-1', meta={}))
    monkeypatch.setattr(env, 'ENABLE_DOCUMENT_VIEWER', True)
    permission = AsyncMock(return_value=True)
    monkeypatch.setattr(access_control, 'has_permission', permission)
    event_call = AsyncMock(return_value={'status': 'opening'})
    args = dict(
        __chat_id__=CHAT_ID,
        __user__={'id': 'user-1', 'role': 'user'},
        __metadata__={'session_id': 'session'},
        __event_call__=event_call,
    )
    assert json.loads(await builtin.workspace_display_file('/mnt/uploads/report.pdf', **args))['status'] == 'opening'
    event_call.assert_awaited_once()
    event_call.reset_mock()
    for path in ['/mnt/uploads/../secret.pdf', '/elsewhere/file.pdf', '/mnt/uploads/script.py']:
        assert 'error' in json.loads(await builtin.workspace_display_file(path, **args))
    permission.return_value = False
    assert 'error' in json.loads(await builtin.workspace_display_file('/mnt/uploads/report.pdf', **args))
    permission.return_value = True
    args['__user__'] = {'id': 'other', 'role': 'admin'}
    assert 'error' in json.loads(await builtin.workspace_display_file('/mnt/uploads/report.pdf', **args))
    event_call.assert_not_awaited()
    args['__user__'] = {'id': 'user-1', 'role': 'admin'}
    event_call.return_value = {'error': 'Chat changed'}
    assert 'error' in json.loads(await builtin.workspace_display_file('/mnt/uploads/report.pdf', **args))


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ('category', 'capabilities', 'features', 'metadata'),
    [
        ('time', {}, {}, {}),
        ('user_input', {}, {}, {}),
        ('files', {'file_upload': True, 'file_context': False}, {}, {'files': [{'id': 'file-1'}]}),
        ('knowledge', {}, {}, {}),
        ('chats', {}, {}, {}),
        ('subagents', {}, {}, {}),
        ('memory', {'memory': True}, {'memory': True}, {}),
        ('web_search', {'web_search': True}, {'web_search': True}, {}),
        ('image_generation', {'image_generation': True}, {'image_generation': True}, {}),
        ('code_interpreter', {'code_interpreter': True}, {'code_interpreter': True}, {}),
        ('notes', {}, {}, {}),
        ('canvas', {'canvas': True}, {}, {}),
        ('web_preview', {'web_preview': True}, {}, {}),
        ('channels', {}, {}, {}),
        ('tasks', {}, {}, {}),
        ('automations', {}, {}, {}),
        ('calendar', {}, {}, {}),
        ('notifications', {}, {}, {}),
    ],
)
async def test_native_builtin_category_registration_matrix(monkeypatch, category, capabilities, features, metadata):
    install_config(monkeypatch)

    tools = await tools_utils.get_builtin_tools(
        make_request(),
        extra_params(metadata=metadata),
        features=features,
        model=model_for(category, capabilities=capabilities),
    )

    assert set(tools) == CATEGORY_TO_TOOLS[category]


@pytest.mark.asyncio
async def test_skill_registration_requires_attached_skill_ids(monkeypatch):
    install_config(monkeypatch)
    model = model_for()

    absent = await tools_utils.get_builtin_tools(make_request(), extra_params(), model=model)
    present = await tools_utils.get_builtin_tools(make_request(), extra_params(skill_ids=['skill-1']), model=model)

    assert 'view_skill' not in absent
    assert set(present) == {'view_skill'}


@pytest.mark.asyncio
async def test_null_builtin_tools_uses_backward_compatible_defaults(monkeypatch):
    install_config(monkeypatch)
    model_without_builtin_tools = {'info': {'meta': {}}}
    model_with_null_builtin_tools = {'info': {'meta': {'builtinTools': None}}}

    expected = await tools_utils.get_builtin_tools(make_request(), extra_params(), model=model_without_builtin_tools)
    actual = await tools_utils.get_builtin_tools(make_request(), extra_params(), model=model_with_null_builtin_tools)

    assert set(actual) == set(expected)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ('category', 'capabilities', 'features', 'flags', 'permissions', 'metadata'),
    [
        ('files', {'file_upload': True, 'file_context': False}, {}, {}, False, {'files': [{'id': 'file-1'}]}),
        ('memory', {'memory': True}, {'memory': True}, {}, False, {}),
        ('web_search', {'web_search': True}, {'web_search': True}, {'web.search.enable': False}, True, {}),
        (
            'image_generation',
            {'image_generation': True},
            {'image_generation': True},
            {'image_generation.enable': False, 'images.edit.enable': False},
            True,
            {},
        ),
        (
            'code_interpreter',
            {'code_interpreter': True},
            {'code_interpreter': True},
            {'code_interpreter.enable': False},
            True,
            {},
        ),
        ('notes', {}, {}, {'notes.enable': False}, True, {}),
        ('canvas', {'canvas': False}, {}, {}, True, {}),
        ('web_preview', {'web_preview': False}, {}, {}, True, {}),
        ('channels', {}, {}, {'channels.enable': False}, True, {}),
        ('automations', {}, {}, {'automations.enable': False}, True, {}),
        ('calendar', {}, {}, {'calendar.enable': False}, True, {}),
        ('notifications', {}, {}, {'ui.enable_user_webhooks': False}, True, {}),
        ('subagents', {}, {}, {'subagents.enable': False}, True, {}),
    ],
)
async def test_native_builtin_gates_reject_disabled_config_capability_or_permission(
    monkeypatch, category, capabilities, features, flags, permissions, metadata
):
    install_config(monkeypatch, flags=flags, permissions=permissions)

    tools = await tools_utils.get_builtin_tools(
        make_request(),
        extra_params(
            metadata=metadata,
            user={'id': 'user-1', 'role': 'user'},
        ),
        features=features,
        model=model_for(category, capabilities=capabilities),
    )

    assert set(tools).isdisjoint(CATEGORY_TO_TOOLS[category])


@pytest.mark.asyncio
async def test_canvas_and_preview_are_excluded_from_internal_note_chats(monkeypatch):
    note_chat = SimpleNamespace(meta={'internal': True, 'type': 'note'})
    install_config(monkeypatch, chat=note_chat)

    tools = await tools_utils.get_builtin_tools(
        make_request(),
        extra_params(),
        model=model_for('canvas', 'web_preview', capabilities={'canvas': True, 'web_preview': True}),
    )

    assert set(tools).isdisjoint(CATEGORY_TO_TOOLS['canvas'])
    assert set(tools).isdisjoint(CATEGORY_TO_TOOLS['web_preview'])
