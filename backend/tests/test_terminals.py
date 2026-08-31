import asyncio
import copy
from types import SimpleNamespace
from unittest.mock import AsyncMock

import open_webui.routers.terminals as terminals_router
import open_webui.utils.terminals as terminals_utils
import open_webui.utils.tools as tools_utils
import pytest
from open_webui.utils.json_codec import JSONCodec
from open_webui.utils.terminals import TerminalChatBindingError, ensure_terminal_chat_binding
from starlette.requests import Request

USER = SimpleNamespace(id='user-a', role='user')
OWNED_CHAT_ID = 'chat-owned'
FOREIGN_CHAT_ID = 'chat-foreign'


def make_request(path, *, headers=None, query_string=b'', method='GET'):
    async def receive():
        return {'type': 'http.request', 'body': b'', 'more_body': False}

    scope = {
        'type': 'http',
        'method': method,
        'path': path,
        'raw_path': path.encode(),
        'query_string': query_string,
        'headers': [(key.lower().encode(), value.encode()) for key, value in (headers or {}).items()],
        'scheme': 'http',
        'server': ('testserver', 80),
        'client': ('testclient', 50000),
        'root_path': '',
        'http_version': '1.1',
    }
    return Request(scope, receive)


class FakeResponse:
    status = 200
    headers = {'content-type': 'application/json'}

    async def read(self):
        return b'{"ok": true}'

    async def release(self):
        pass


class FakeSession:
    def __init__(self):
        self.calls = []
        self.response = FakeResponse()

    async def request(self, **kwargs):
        self.calls.append(kwargs)
        return self.response

    async def close(self):
        pass


def patch_proxy_dependencies(monkeypatch, connection, *, chat=None):
    session = FakeSession()
    binding = AsyncMock(return_value=True)
    monkeypatch.setattr(terminals_router.Config, 'get', AsyncMock(return_value=[connection]))
    monkeypatch.setattr(terminals_router.Groups, 'get_groups_by_member_id', AsyncMock(return_value=[]))
    monkeypatch.setattr(terminals_router, 'has_connection_access', AsyncMock(return_value=True))
    monkeypatch.setattr(terminals_router.Chats, 'get_chat_by_id_and_user_id', AsyncMock(return_value=chat))
    monkeypatch.setattr(terminals_router, 'ensure_terminal_chat_binding', binding)
    monkeypatch.setattr(terminals_router.aiohttp, 'ClientSession', lambda **_kwargs: session)
    session.binding = binding
    return session


def test_proxy_rejects_unscoped_native_path_without_upstream_request(monkeypatch):
    connection = {'id': 'terminal-a', 'url': 'https://terminal.test', 'auth_type': 'none'}
    session = patch_proxy_dependencies(monkeypatch, connection)

    response = asyncio.run(terminals_router.proxy_terminal(
        'terminal-a', 'files/list', make_request('files/list'), user=USER
    ))

    assert response.status_code == 409
    assert session.calls == []


def test_proxy_rejects_foreign_chat_path(monkeypatch):
    connection = {'id': 'terminal-a', 'url': 'https://terminal.test', 'auth_type': 'none'}
    session = patch_proxy_dependencies(monkeypatch, connection)
    session.binding.side_effect = TerminalChatBindingError('Chat not found', status_code=404)

    response = asyncio.run(terminals_router.proxy_terminal(
        'terminal-a',
        f'chat/{FOREIGN_CHAT_ID}/files/list',
        make_request(f'chat/{FOREIGN_CHAT_ID}/files/list'),
        user=USER,
    ))

    assert response.status_code == 404
    assert session.calls == []


def test_proxy_rejects_mismatched_header_and_path_chat(monkeypatch):
    connection = {'id': 'terminal-a', 'url': 'https://terminal.test', 'auth_type': 'none'}
    session = patch_proxy_dependencies(monkeypatch, connection, chat=SimpleNamespace(id=OWNED_CHAT_ID))

    response = asyncio.run(terminals_router.proxy_terminal(
        'terminal-a',
        f'chat/{OWNED_CHAT_ID}/files/list',
        make_request(
            f'chat/{OWNED_CHAT_ID}/files/list',
            headers={'X-Session-Id': FOREIGN_CHAT_ID},
        ),
        user=USER,
    ))

    assert response.status_code == 400
    assert session.calls == []


def test_proxy_rejects_disabled_chat_context(monkeypatch):
    connection = {
        'id': 'terminal-a',
        'url': 'https://terminal.test',
        'auth_type': 'none',
        'server_type': 'orchestrator',
        'config': {'contexts': {'chat': False}},
    }
    session = patch_proxy_dependencies(monkeypatch, connection, chat=SimpleNamespace(id=OWNED_CHAT_ID))

    response = asyncio.run(terminals_router.proxy_terminal(
        'terminal-a',
        f'chat/{OWNED_CHAT_ID}/files/list',
        make_request(f'chat/{OWNED_CHAT_ID}/files/list'),
        user=USER,
    ))

    assert response.status_code == 403
    assert session.calls == []


def test_proxy_forwards_scoped_port_path_query_and_context(monkeypatch):
    connection = {
        'id': 'terminal-a',
        'url': 'https://terminal.test',
        'auth_type': 'none',
        'server_type': 'orchestrator',
        'config': {'contexts': {'chat': {'context_id': 'chat_id'}}},
    }
    session = patch_proxy_dependencies(monkeypatch, connection, chat=SimpleNamespace(id=OWNED_CHAT_ID))
    path = f'chat/{OWNED_CHAT_ID}/proxy/8080/index.html'

    response = asyncio.run(terminals_router.proxy_terminal(
        'terminal-a',
        path,
        make_request(path, query_string=b'file=%2Fworkspace%2Findex.html&download=true'),
        user=USER,
    ))

    assert response.status_code == 200
    assert session.calls[0]['url'] == (
        'https://terminal.test/proxy/8080/index.html?file=%2Fworkspace%2Findex.html&download=true'
    )
    assert session.calls[0]['headers']['X-Session-Id'] == OWNED_CHAT_ID
    assert session.calls[0]['headers']['X-Terminal-Context-Id'] == f'chat:{OWNED_CHAT_ID}'
    session.binding.assert_awaited_once_with(OWNED_CHAT_ID, USER.id, 'terminal-a')


def test_proxy_preserves_legacy_owned_saved_chat_header_scope(monkeypatch):
    connection = {'id': 'terminal-a', 'url': 'https://terminal.test', 'auth_type': 'none'}
    session = patch_proxy_dependencies(monkeypatch, connection, chat=SimpleNamespace(id=OWNED_CHAT_ID))

    response = asyncio.run(terminals_router.proxy_terminal(
        'terminal-a',
        'files/list',
        make_request('files/list', headers={'X-Session-Id': OWNED_CHAT_ID}),
        user=USER,
    ))

    assert response.status_code == 200
    assert session.calls[0]['url'] == 'https://terminal.test/files/list'
    assert session.calls[0]['headers']['X-Session-Id'] == OWNED_CHAT_ID
    session.binding.assert_awaited_once_with(OWNED_CHAT_ID, USER.id, 'terminal-a')


def test_shell_creation_keeps_chat_context_without_reusing_chat_id_as_pty_id(monkeypatch):
    connection = {
        'id': 'terminal-a', 'url': 'https://terminal.test', 'auth_type': 'none',
        'server_type': 'orchestrator',
        'config': {'contexts': {'chat': {'context_id': 'chat_id'}}},
    }
    session = patch_proxy_dependencies(monkeypatch, connection)
    path = f'chat/{OWNED_CHAT_ID}/api/terminals'
    response = asyncio.run(terminals_router.proxy_terminal(
        'terminal-a', path, make_request(path, method='POST'), user=USER,
    ))
    assert response.status_code == 200
    headers = session.calls[0]['headers']
    assert 'X-Session-Id' not in headers
    assert headers['X-Terminal-Context-Id'] == f'chat:{OWNED_CHAT_ID}'
    assert headers['X-User-Id'] == USER.id
    session.binding.assert_awaited_once_with(OWNED_CHAT_ID, USER.id, 'terminal-a')


def test_proxy_rejects_chat_bound_to_a_different_terminal(monkeypatch):
    connection = {'id': 'terminal-a', 'url': 'https://terminal.test', 'auth_type': 'none'}
    session = patch_proxy_dependencies(monkeypatch, connection)
    session.binding.side_effect = TerminalChatBindingError('Chat is already bound to a different terminal')
    path = f'chat/{OWNED_CHAT_ID}/files/list'

    response = asyncio.run(terminals_router.proxy_terminal('terminal-a', path, make_request(path), user=USER))

    assert response.status_code == 409
    assert session.calls == []


@pytest.mark.parametrize('path', ['api/config', 'health', 'openapi.json'])
def test_proxy_allows_unscoped_discovery_paths(monkeypatch, path):
    connection = {
        'id': 'terminal-a',
        'url': 'https://terminal.test',
        'auth_type': 'none',
        'server_type': 'orchestrator',
        'config': {'contexts': {'chat': False}},
    }
    session = patch_proxy_dependencies(monkeypatch, connection)

    response = asyncio.run(terminals_router.proxy_terminal('terminal-a', path, make_request(path), user=USER))

    assert response.status_code == 200
    assert session.calls[0]['url'] == f'https://terminal.test/{path}'
    session.binding.assert_not_awaited()


def test_proxy_discovery_still_requires_connection_access(monkeypatch):
    connection = {
        'id': 'terminal-a',
        'url': 'https://terminal.test',
        'auth_type': 'none',
        'server_type': 'orchestrator',
        'config': {'contexts': {'chat': False}},
    }
    session = patch_proxy_dependencies(monkeypatch, connection)
    monkeypatch.setattr(terminals_router, 'has_connection_access', AsyncMock(return_value=False))

    response = asyncio.run(
        terminals_router.proxy_terminal('terminal-a', 'api/config', make_request('api/config'), user=USER)
    )

    assert response.status_code == 403
    assert session.calls == []


def test_ensure_terminal_chat_binding_rejects_missing_chat_and_existing_mismatch(monkeypatch):
    mutate = AsyncMock()
    monkeypatch.setattr(terminals_utils.Chats, 'mutate_chat_by_id', mutate)
    monkeypatch.setattr(
        terminals_utils.Chats,
        'get_chat_by_id_and_user_id',
        AsyncMock(return_value=SimpleNamespace(chat={'terminal_id': 'terminal-a'})),
    )

    with pytest.raises(TerminalChatBindingError, match='different terminal'):
        asyncio.run(ensure_terminal_chat_binding(OWNED_CHAT_ID, USER.id, 'terminal-b'))
    mutate.assert_not_awaited()

    monkeypatch.setattr(
        terminals_utils.Chats,
        'get_chat_by_id_and_user_id',
        AsyncMock(return_value=SimpleNamespace(chat={'terminal_id': 'terminal-a'})),
    )
    assert asyncio.run(ensure_terminal_chat_binding(OWNED_CHAT_ID, USER.id, 'terminal-a'))
    mutate.assert_not_awaited()

    monkeypatch.setattr(terminals_utils.Chats, 'get_chat_by_id_and_user_id', AsyncMock(return_value=None))
    with pytest.raises(TerminalChatBindingError, match='Chat not found'):
        asyncio.run(ensure_terminal_chat_binding(OWNED_CHAT_ID, USER.id, 'terminal-a'))
    mutate.assert_not_awaited()


def test_ensure_terminal_chat_binding_allows_one_concurrent_first_claim(monkeypatch):
    async def scenario():
        state = {'chat': {}}
        lock = asyncio.Lock()
        reads_ready = asyncio.Event()
        read_count = 0
        mutation_count = 0

        async def get_chat(_chat_id, _user_id):
            nonlocal read_count
            snapshot = copy.deepcopy(state['chat'])
            read_count += 1
            if read_count == 2:
                reads_ready.set()
            await reads_ready.wait()
            return SimpleNamespace(chat=snapshot)

        async def mutate_chat(_chat_id, mutator, *, user_id=None, touch=False):
            nonlocal mutation_count
            assert user_id == USER.id
            assert touch is False
            async with lock:
                mutation_count += 1
                updated, result = await mutator(copy.deepcopy(state['chat']), None)
                state['chat'] = updated
                return SimpleNamespace(chat=copy.deepcopy(updated)), result

        monkeypatch.setattr(terminals_utils.Chats, 'get_chat_by_id_and_user_id', get_chat)
        monkeypatch.setattr(terminals_utils.Chats, 'mutate_chat_by_id', mutate_chat)
        results = await asyncio.gather(
            ensure_terminal_chat_binding(OWNED_CHAT_ID, USER.id, 'terminal-a'),
            ensure_terminal_chat_binding(OWNED_CHAT_ID, USER.id, 'terminal-b'),
            return_exceptions=True,
        )
        return state, mutation_count, results

    state, mutation_count, results = asyncio.run(scenario())

    assert mutation_count == 2
    assert state['chat']['terminal_id'] in {'terminal-a', 'terminal-b'}
    assert sum(result is True for result in results) == 1
    errors = [result for result in results if isinstance(result, TerminalChatBindingError)]
    assert len(errors) == 1
    assert str(errors[0]) == 'Chat is already bound to a different terminal'


class FakeWebSocket:
    def __init__(self, payload):
        self.payload = JSONCodec.dumps(payload)
        self.app = SimpleNamespace(state=SimpleNamespace(redis=None))
        self.closed = []

    async def receive_text(self):
        return self.payload

    async def close(self, **kwargs):
        self.closed.append(kwargs)


def patch_websocket_dependencies(monkeypatch, connection, *, binding_error=None):
    user = SimpleNamespace(id='user-a', role='user')
    binding = AsyncMock(side_effect=binding_error)
    monkeypatch.setattr(
        'open_webui.utils.auth.get_verified_user_by_token',
        AsyncMock(return_value=user),
    )
    monkeypatch.setattr(terminals_router.Config, 'get', AsyncMock(return_value=[connection]))
    monkeypatch.setattr(terminals_router.Groups, 'get_groups_by_member_id', AsyncMock(return_value=[]))
    monkeypatch.setattr(terminals_router, 'has_connection_access', AsyncMock(return_value=True))
    monkeypatch.setattr(terminals_router, 'ensure_terminal_chat_binding', binding)
    return binding


def test_websocket_rejects_missing_chat_scope(monkeypatch):
    connection = {'id': 'terminal-a', 'url': 'https://terminal.test', 'auth_type': 'none'}
    binding = patch_websocket_dependencies(
        monkeypatch,
        connection,
        binding_error=TerminalChatBindingError('A saved chat is required for this terminal'),
    )
    ws = FakeWebSocket({'type': 'auth', 'token': 'token'})

    result = asyncio.run(terminals_router._resolve_authenticated_connection(ws, 'terminal-a'))

    assert result is None
    assert ws.closed == [{'code': 4003, 'reason': 'A saved chat is required for this terminal'}]
    binding.assert_awaited_once_with('', 'user-a', 'terminal-a')


def test_websocket_rejects_foreign_chat(monkeypatch):
    connection = {'id': 'terminal-a', 'url': 'https://terminal.test', 'auth_type': 'none'}
    binding = patch_websocket_dependencies(
        monkeypatch,
        connection,
        binding_error=TerminalChatBindingError('Chat not found', status_code=404),
    )
    ws = FakeWebSocket({'type': 'auth', 'token': 'token', 'chat_id': FOREIGN_CHAT_ID})

    result = asyncio.run(terminals_router._resolve_authenticated_connection(ws, 'terminal-a'))

    assert result is None
    assert ws.closed == [{'code': 4003, 'reason': 'Chat not found'}]
    binding.assert_awaited_once_with(FOREIGN_CHAT_ID, 'user-a', 'terminal-a')


def test_websocket_rejects_disabled_chat_context(monkeypatch):
    connection = {
        'id': 'terminal-a',
        'url': 'https://terminal.test',
        'auth_type': 'none',
        'server_type': 'orchestrator',
        'config': {'contexts': {'chat': False}},
    }
    binding = patch_websocket_dependencies(monkeypatch, connection)
    ws = FakeWebSocket({'type': 'auth', 'token': 'token', 'chat_id': OWNED_CHAT_ID})

    result = asyncio.run(terminals_router._resolve_authenticated_connection(ws, 'terminal-a'))

    assert result is None
    assert ws.closed == [{'code': 4003, 'reason': 'Terminal server is not available in chats'}]
    binding.assert_not_awaited()


def test_websocket_accepts_owned_saved_chat(monkeypatch):
    connection = {'id': 'terminal-a', 'url': 'https://terminal.test', 'auth_type': 'none'}
    binding = patch_websocket_dependencies(monkeypatch, connection)
    ws = FakeWebSocket({'type': 'auth', 'token': 'token', 'chat_id': OWNED_CHAT_ID})

    result = asyncio.run(terminals_router._resolve_authenticated_connection(ws, 'terminal-a'))

    assert result[0].id == USER.id
    assert result[1] == connection
    assert result[2:] == (OWNED_CHAT_ID, 'token')
    assert ws.closed == []
    binding.assert_awaited_once_with(OWNED_CHAT_ID, 'user-a', 'terminal-a')


def test_model_terminal_tools_require_owned_saved_chat_before_loading_tools(monkeypatch):
    connection = {'id': 'terminal-a', 'url': 'https://terminal.test', 'auth_type': 'none'}
    binding = AsyncMock(side_effect=TerminalChatBindingError('A saved chat is required for this terminal'))
    servers = AsyncMock()
    monkeypatch.setattr(tools_utils.Config, 'get', AsyncMock(return_value=[connection]))
    monkeypatch.setattr(tools_utils.Groups, 'get_groups_by_member_id', AsyncMock(return_value=[]))
    monkeypatch.setattr(tools_utils, 'has_connection_access', AsyncMock(return_value=True))
    monkeypatch.setattr(tools_utils, 'ensure_terminal_chat_binding', binding)
    monkeypatch.setattr(tools_utils, 'get_terminal_servers', servers)

    with pytest.raises(RuntimeError, match='saved chat'):
        asyncio.run(tools_utils.get_terminal_tools(SimpleNamespace(), 'terminal-a', USER, {'__metadata__': {}}))

    binding.assert_awaited_once_with(None, USER.id, 'terminal-a')
    servers.assert_not_awaited()


def test_model_terminal_tools_keep_automation_context_with_saved_chat(monkeypatch):
    connection = {
        'id': 'terminal-a',
        'url': 'https://terminal.test',
        'auth_type': 'none',
        'server_type': 'orchestrator',
        'config': {'contexts': {'automation': {'context_id': 'automation_id'}}},
    }
    binding = AsyncMock(return_value=True)
    monkeypatch.setattr(tools_utils.Config, 'get', AsyncMock(return_value=[connection]))
    monkeypatch.setattr(tools_utils.Groups, 'get_groups_by_member_id', AsyncMock(return_value=[]))
    monkeypatch.setattr(tools_utils, 'has_connection_access', AsyncMock(return_value=True))
    monkeypatch.setattr(tools_utils, 'ensure_terminal_chat_binding', binding)
    monkeypatch.setattr(
        tools_utils,
        'get_terminal_servers',
        AsyncMock(
            return_value=[
                {
                    'id': 'terminal-a',
                    'url': 'https://terminal.test',
                    'specs': [
                        {
                            'name': 'run_command',
                            'description': 'Run a command',
                            'parameters': {'type': 'object', 'properties': {}},
                        }
                    ],
                }
            ]
        ),
    )
    monkeypatch.setattr(tools_utils, 'get_terminal_cwd', AsyncMock(return_value=None))
    monkeypatch.setattr(tools_utils, 'get_terminal_system_prompt', AsyncMock(return_value=None))

    result = asyncio.run(
        tools_utils.get_terminal_tools(
            SimpleNamespace(cookies={}),
            'terminal-a',
            USER,
            {'__metadata__': {'automation_id': 'automation-a', 'chat_id': OWNED_CHAT_ID}},
        )
    )

    assert result[0]['run_command']['type'] == 'terminal'
    binding.assert_awaited_once_with(OWNED_CHAT_ID, USER.id, 'terminal-a')
