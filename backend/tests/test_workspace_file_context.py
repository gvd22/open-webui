from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from open_webui.utils import middleware
from open_webui.utils.middleware import has_pyodide_workspace_access, validate_workspace_file_reference


@pytest.mark.parametrize(
    ('reference', 'available', 'expected'),
    [
        ({'path': '/mnt/uploads/brief.docx', 'format': 'docx'}, True, True),
        ({'path': '/mnt/uploads/deck.pptx', 'format': 'pdf'}, True, False),
        ({'path': '/mnt/uploads/sheet.xlsx', 'format': 'xlsx'}, True, False),
        ({'path': '/mnt/uploads/bad\ndoc.pdf', 'format': 'pdf'}, True, False),
        ({'path': '/mnt/uploads/../private.pdf', 'format': 'pdf'}, True, False),
        ({'path': '/mnt/uploads//deck.pptx', 'format': 'pptx'}, True, False),
        ({'path': '/mnt/uploads\\deck.pptx', 'format': 'pptx'}, True, False),
        ({'path': '/workspace/deck.pptx', 'format': 'pptx'}, True, False),
        ({'path': '/mnt/uploads/evil\u202epptx.pdf', 'format': 'pdf'}, True, False),
        ({'path': '/mnt/uploads/brief.docx', 'format': 'docx'}, False, False),
    ],
)
def test_workspace_file_reference_validation(reference, available, expected):
    result = validate_workspace_file_reference(reference, pyodide_available=available)

    assert bool(result) is expected
    if expected:
        assert result == reference


def test_workspace_file_reference_rejects_oversized_paths():
    reference = {'path': f'/mnt/uploads/{"a" * 4090}.pdf', 'format': 'pdf'}

    assert validate_workspace_file_reference(reference, pyodide_available=True) is None


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ('feature', 'engine', 'enabled', 'capability', 'builtin', 'role', 'permission', 'expected'),
    [
        (True, 'pyodide', True, True, True, 'admin', False, True),
        (True, 'pyodide', True, True, True, 'user', True, True),
        (False, 'pyodide', True, True, True, 'admin', True, False),
        (True, 'jupyter', True, True, True, 'admin', True, False),
        (True, 'pyodide', False, True, True, 'admin', True, False),
        (True, 'pyodide', True, False, True, 'admin', True, False),
        (True, 'pyodide', True, True, False, 'admin', True, False),
        (True, 'pyodide', True, True, True, 'user', False, False),
    ],
)
async def test_pyodide_workspace_access_matrix(
    monkeypatch, feature, engine, enabled, capability, builtin, role, permission, expected
):
    values = {
        'code_interpreter.engine': engine,
        'code_interpreter.enable': enabled,
        'user.permissions': {},
    }

    async def config_get(key, default=None):
        return values.get(key, default)

    monkeypatch.setattr(middleware.Config, 'get', config_get)
    monkeypatch.setattr(middleware, 'has_permission', AsyncMock(return_value=permission))

    result = await has_pyodide_workspace_access(
        {'features': {'code_interpreter': feature}},
        SimpleNamespace(id='user-a', role=role),
        {
            'info': {
                'meta': {
                    'capabilities': {'code_interpreter': capability},
                    'builtinTools': {'code_interpreter': builtin},
                }
            }
        },
    )

    assert result is expected
