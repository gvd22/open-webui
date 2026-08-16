from types import SimpleNamespace

import pytest

from open_webui.utils import middleware
from open_webui.utils.middleware import has_workspace_runtime_access, validate_workspace_file_reference


def test_workspace_file_reference_requires_an_active_runtime():
    reference = {'path': '/workspace/brief.docx', 'format': 'docx'}

    assert validate_workspace_file_reference(reference, runtime_available=False) is None
    assert validate_workspace_file_reference(reference, runtime_available=True) == reference


def test_workspace_file_reference_accepts_only_supported_matching_formats():
    assert validate_workspace_file_reference(
        {'path': '/workspace/deck.pptx', 'format': 'pptx'}, runtime_available=True
    ) == {'path': '/workspace/deck.pptx', 'format': 'pptx'}
    assert (
        validate_workspace_file_reference({'path': '/workspace/deck.pptx', 'format': 'pdf'}, runtime_available=True)
        is None
    )
    assert (
        validate_workspace_file_reference({'path': '/workspace/sheet.xlsx', 'format': 'xlsx'}, runtime_available=True)
        is None
    )


def test_workspace_file_reference_rejects_control_characters_and_oversized_paths():
    assert (
        validate_workspace_file_reference({'path': '/workspace/bad\ndoc.pdf', 'format': 'pdf'}, runtime_available=True)
        is None
    )
    assert (
        validate_workspace_file_reference(
            {'path': f'/workspace/{"a" * 4090}.pdf', 'format': 'pdf'}, runtime_available=True
        )
        is None
    )


def test_workspace_file_reference_rejects_noncanonical_and_ambiguous_paths():
    invalid_references = [
        {'path': 'workspace/deck.pptx', 'format': 'pptx'},
        {'path': '/workspace/../secrets/deck.pptx', 'format': 'pptx'},
        {'path': '/workspace//deck.pptx', 'format': 'pptx'},
        {'path': '/workspace\\deck.pptx', 'format': 'pptx'},
        {'path': '/workspace/evil\u202epptx.pdf', 'format': 'pdf'},
    ]

    for reference in invalid_references:
        assert validate_workspace_file_reference(reference, runtime_available=True) is None


@pytest.mark.asyncio
async def test_workspace_runtime_requires_an_enabled_authorized_terminal(monkeypatch):
    async def config_get(key, default=None):
        if key == 'terminal_server.connections':
            return [{'id': 'terminal-a', 'enabled': True}]
        return default

    async def denied_access(*_args, **_kwargs):
        return False

    monkeypatch.setattr(middleware.Config, 'get', config_get)
    monkeypatch.setattr(middleware, 'has_connection_access', denied_access)

    assert not await has_workspace_runtime_access(
        SimpleNamespace(),
        {'terminal_id': 'terminal-a'},
        SimpleNamespace(id='user-a', role='user'),
        {'info': {'meta': {}}},
    )
    assert not await has_workspace_runtime_access(
        SimpleNamespace(),
        {'terminal_id': 'missing'},
        SimpleNamespace(id='user-a', role='user'),
        {'info': {'meta': {}}},
    )


@pytest.mark.asyncio
async def test_workspace_runtime_accepts_authorized_terminal(monkeypatch):
    async def config_get(key, default=None):
        if key == 'terminal_server.connections':
            return [{'id': 'terminal-a', 'enabled': True}]
        return default

    async def allowed_access(*_args, **_kwargs):
        return True

    async def terminal_servers(_request):
        return [{'id': 'terminal-a', 'specs': [{'name': 'execute'}]}]

    monkeypatch.setattr(middleware.Config, 'get', config_get)
    monkeypatch.setattr(middleware, 'has_connection_access', allowed_access)
    monkeypatch.setattr(middleware, 'get_terminal_servers', terminal_servers)

    assert await has_workspace_runtime_access(
        SimpleNamespace(),
        {'terminal_id': 'terminal-a'},
        SimpleNamespace(id='user-a', role='user'),
        {'info': {'meta': {}}},
    )


@pytest.mark.asyncio
async def test_workspace_runtime_rejects_terminal_without_available_tools(monkeypatch):
    async def config_get(key, default=None):
        if key == 'terminal_server.connections':
            return [{'id': 'terminal-a', 'enabled': True}]
        return default

    async def allowed_access(*_args, **_kwargs):
        return True

    async def terminal_servers(_request):
        return [{'id': 'terminal-a', 'specs': []}]

    monkeypatch.setattr(middleware.Config, 'get', config_get)
    monkeypatch.setattr(middleware, 'has_connection_access', allowed_access)
    monkeypatch.setattr(middleware, 'get_terminal_servers', terminal_servers)

    assert not await has_workspace_runtime_access(
        SimpleNamespace(),
        {'terminal_id': 'terminal-a'},
        SimpleNamespace(id='user-a', role='user'),
        {'info': {'meta': {}}},
    )


@pytest.mark.asyncio
async def test_workspace_runtime_rejects_jupyter_for_browser_file_tabs(monkeypatch):
    async def config_get(key, default=None):
        if key == 'code_interpreter.engine':
            return 'jupyter'
        return default

    monkeypatch.setattr(middleware.Config, 'get', config_get)

    assert not await has_workspace_runtime_access(
        SimpleNamespace(),
        {'features': {'code_interpreter': True}},
        SimpleNamespace(id='user-a', role='admin'),
        {'info': {'meta': {}}},
    )


@pytest.mark.asyncio
async def test_workspace_runtime_respects_model_builtin_code_interpreter_gate(monkeypatch):
    async def config_get(key, default=None):
        if key == 'code_interpreter.engine':
            return 'pyodide'
        if key == 'code_interpreter.enable':
            return True
        return default

    monkeypatch.setattr(middleware.Config, 'get', config_get)

    assert not await has_workspace_runtime_access(
        SimpleNamespace(),
        {'features': {'code_interpreter': True}},
        SimpleNamespace(id='admin-a', role='admin'),
        {'info': {'meta': {'builtinTools': {'code_interpreter': False}}}},
    )
