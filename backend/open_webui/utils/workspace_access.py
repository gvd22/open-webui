"""Access policy for chat-local Workspace tools and runtime references."""

import posixpath
import unicodedata

from open_webui.models.config import Config
from open_webui.utils.access_control import has_permission

APPROVAL_FREE_WORKSPACE_TOOLS = frozenset(
    {
        'canvas_create_document',
        'canvas_update_document',
        'canvas_select_document',
        'canvas_list_documents',
        'canvas_read_document',
        'canvas_replace_text',
        'web_preview_create',
        'web_preview_update',
        'web_preview_select',
        'web_preview_list',
        'web_preview_read_file',
        'web_preview_replace_text',
    }
)


def tool_requires_approval(name: str, metadata: dict) -> bool:
    """Keep approval bypasses limited to trusted, chat-local built-ins."""
    if name not in APPROVAL_FREE_WORKSPACE_TOOLS:
        return True

    tool = (metadata.get('tools') or {}).get(name)
    return not (isinstance(tool, dict) and tool.get('type') == 'builtin' and tool.get('tool_id') == f'builtin:{name}')


def validate_workspace_file_reference(reference, *, pyodide_available: bool):
    if not pyodide_available or not isinstance(reference, dict):
        return None

    path = reference.get('path')
    file_format = reference.get('format')
    if (
        not isinstance(path, str)
        or not 0 < len(path) <= 4096
        or not path.startswith('/mnt/uploads/')
        or '\\' in path
        or posixpath.normpath(path) != path
        or any(unicodedata.category(character) in {'Cc', 'Cf'} for character in path)
        or file_format not in {'pdf', 'docx', 'pptx'}
        or not path.lower().endswith(f'.{file_format}')
    ):
        return None

    return {'path': path, 'format': file_format}


async def has_pyodide_workspace_access(form_data, user, model) -> bool:
    features = form_data.get('features') or {}
    if not features.get('code_interpreter'):
        return False
    if await Config.get('code_interpreter.engine', 'pyodide') == 'jupyter':
        return False
    model_capability = (model.get('info', {}).get('meta', {}).get('capabilities') or {}).get('code_interpreter', True)
    builtin_enabled = (model.get('info', {}).get('meta', {}).get('builtinTools') or {}).get('code_interpreter', True)
    if not builtin_enabled or not model_capability or not await Config.get('code_interpreter.enable'):
        return False
    return getattr(user, 'role', None) == 'admin' or await has_permission(
        getattr(user, 'id', ''),
        'features.code_interpreter',
        await Config.get('user.permissions'),
    )
