import asyncio
import json
from copy import deepcopy
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from starlette.requests import Request

from open_webui.routers.chat_artifacts import ArtifactUndoForm, undo_last_canvas_ai_update
from open_webui.utils.canvas import CANVAS_DOCUMENTS_KEY, build_canvas_document_update, canvas_content_hash
from open_webui.utils.web_preview import build_web_preview_document_update, normalize_web_preview_files, web_preview_content_hash
from open_webui.utils.workspace_context import compact_workspace_tool_output


@pytest.mark.parametrize('kind', ['canvas', 'web_preview'])
def test_legacy_diffs_are_removed_from_storage_and_replayed_context(kind):
    result = {
        'type': f'{kind}.document',
        'title': 'Keep this reference',
        'changes': [{'path': 'Text', 'before': '<script>old</script>', 'after': 'new'}] * 200,
    }
    output = [
        {'type': 'function_call', 'call_id': 'c', 'name': f'{kind}_replace_text', 'arguments': '{}'},
        {'type': 'function_call_output', 'call_id': 'c',
         'output': [{'type': 'input_text', 'text': json.dumps(result)}]},
    ]
    original = deepcopy(output)
    stored = compact_workspace_tool_output(output)
    data = json.loads(stored[1]['output'][0]['text'])
    assert data['title'] == result['title'] and 'changes' not in data
    assert compact_workspace_tool_output(stored) == stored
    assert output == original


def test_canvas_undo_rejects_stale_versions_and_is_single_use(install_chat_mutator):
    before = {'canvas_id': 'one', 'title': 'A', 'content': 'Before', 'title_edited': True, 'updated_at': 1}
    current = build_canvas_document_update(
        'one', before, content='After', source='ai', expected_updated_at=1,
        expected_content_hash=canvas_content_hash('Before'),
    )
    chat = SimpleNamespace(id='chat-one', user_id='user-one', chat={CANVAS_DOCUMENTS_KEY: {'one': current}})
    install_chat_mutator(chat)

    def undo(version):
        return asyncio.run(undo_last_canvas_ai_update(
            Request({'type': 'http', 'method': 'POST', 'path': '/'}), chat.id, 'one',
            form_data=version, user=SimpleNamespace(id='user-one'),
        ))

    version = ArtifactUndoForm(expected_updated_at=current['updated_at'], expected_content_hash=canvas_content_hash(current['content']))
    unchanged = deepcopy(chat.chat)
    with pytest.raises(HTTPException) as exc:
        undo(ArtifactUndoForm(expected_updated_at=1, expected_content_hash=canvas_content_hash('Before')))
    assert exc.value.status_code == 409 and chat.chat == unchanged
    restored = undo(version)
    assert restored['last_ai_update'] is None and restored['content'] == 'Before'
    with pytest.raises(HTTPException) as exc:
        undo(version)
    assert exc.value.status_code == 409


def test_preview_updates_discard_legacy_undo_snapshot_without_mutating_input():
    before = {
        'preview_id': 'one', 'title': 'A', 'entrypoint': 'index.html',
        'files': normalize_web_preview_files({'index.html': '<h1>A</h1>'}),
        'updated_at': 1, 'last_ai_update': {'files': {'legacy.html': 'Old snapshot'}},
    }
    original = deepcopy(before)
    updated = build_web_preview_document_update(
        'one', before, files={'index.html': '<h1>B</h1>'}, expected_updated_at=1,
        expected_content_hash=web_preview_content_hash(before),
    )
    assert 'last_ai_update' not in updated
    assert updated['files']['index.html']['content'] == '<h1>B</h1>'
    assert before == original
