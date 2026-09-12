import asyncio
import json
from copy import deepcopy
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from starlette.requests import Request

from open_webui.routers.chat_artifacts import (
    ArtifactUndoForm,
    undo_last_canvas_ai_update,
    undo_last_web_preview_ai_update,
)
from open_webui.utils.artifact_changes import artifact_changes
from open_webui.utils.canvas import CANVAS_DOCUMENTS_KEY, build_canvas_document_update, canvas_content_hash
from open_webui.utils.web_preview import (
    WEB_PREVIEW_DOCUMENTS_KEY,
    build_web_preview_document_update,
    normalize_web_preview_files,
    web_preview_content_hash,
)
from open_webui.utils.workspace_context import compact_workspace_tool_output


def test_bounded_diff_handles_insert_delete_unicode_and_literal_html():
    doc = {
        'title': 'Same',
        'content': 'prefix <script>new</script> suffix',
        'last_ai_update': {'title': 'Same', 'content': 'prefix old suffix'},
    }
    assert artifact_changes(doc) == [
        {
            'path': 'Canvas',
            'before': 'prefix old suffix',
            'after': 'prefix <script>new</script> suffix',
            'truncated': False,
        }
    ]
    doc['content'] = 'x' * 100_000
    doc['last_ai_update']['content'] = 'y' * 100_000
    assert artifact_changes(doc)[0]['truncated']
    assert sum(len(c['before']) + len(c['after']) for c in artifact_changes(doc)) <= 12_000
    for before, after in [('', 'added'), ('removed', ''), ('abc', 'abXc')]:
        change = artifact_changes({'content': after, 'last_ai_update': {'content': before}})[0]
        assert before != after and (change['before'] or change['after'])


def test_diff_survives_storage_compaction_but_not_model_context():
    result = {
        'type': 'canvas.document',
        'canvasId': 'one',
        'content': 'secret source',
        'changes': [{'path': 'Canvas', 'before': '<script>old</script>', 'after': 'new', 'truncated': False}],
    }
    output = [
        {'type': 'function_call', 'call_id': 'c', 'name': 'canvas_replace_text', 'arguments': '{}'},
        {
            'type': 'function_call_output',
            'call_id': 'c',
            'output': [{'type': 'input_text', 'text': json.dumps(result)}],
        },
    ]
    stored = compact_workspace_tool_output(output)
    data = json.loads(stored[1]['output'][0]['text'])
    assert data['canvasId'] == 'one' and data['changes'] == result['changes'] and 'content' not in data
    replay = compact_workspace_tool_output(stored, include_changes=False)
    assert 'changes' not in json.loads(replay[1]['output'][0]['text'])
    result['changes'] *= 200
    output[1]['output'][0]['text'] = json.dumps(result)
    bounded = json.loads(compact_workspace_tool_output(output)[1]['output'][0]['text'])
    assert bounded['canvasId'] == 'one' and len(bounded['changes']) <= 24


@pytest.mark.parametrize('kind', ['canvas', 'web_preview'])
def test_undo_rejects_stale_versions_and_is_single_use(kind, install_chat_mutator):
    if kind == 'canvas':
        before = {'canvas_id': 'one', 'title': 'A', 'content': 'Before', 'title_edited': True, 'updated_at': 1}
        current = build_canvas_document_update(
            'one',
            before,
            content='After',
            source='ai',
            expected_updated_at=1,
            expected_content_hash=canvas_content_hash('Before'),
        )
        hash_of = lambda doc: canvas_content_hash(doc['content'])
        key = CANVAS_DOCUMENTS_KEY
    else:
        before = {
            'preview_id': 'one',
            'title': 'A',
            'entrypoint': 'index.html',
            'files': normalize_web_preview_files({'index.html': '<h1>Before</h1>'}),
            'updated_at': 1,
        }
        current = build_web_preview_document_update(
            'one',
            before,
            files={'index.html': '<h1>After</h1>', 'data.json': '{}'},
            source='ai',
            expected_updated_at=1,
            expected_content_hash=web_preview_content_hash(before),
        )
        hash_of = web_preview_content_hash
        key = WEB_PREVIEW_DOCUMENTS_KEY
    chat = SimpleNamespace(id='chat-one', user_id='user-one', chat={key: {'one': current}})
    install_chat_mutator(chat)

    def undo(version):
        args = (Request({'type': 'http', 'method': 'POST', 'path': '/'}),) if kind == 'canvas' else ()
        route = undo_last_canvas_ai_update if kind == 'canvas' else undo_last_web_preview_ai_update
        return asyncio.run(route(*args, chat.id, 'one', form_data=version, user=SimpleNamespace(id='user-one')))

    version = ArtifactUndoForm(expected_updated_at=current['updated_at'], expected_content_hash=hash_of(current))
    unchanged = deepcopy(chat.chat)
    with pytest.raises(HTTPException) as exc:
        undo(ArtifactUndoForm(expected_updated_at=1, expected_content_hash=hash_of(before)))
    assert exc.value.status_code == 409 and chat.chat == unchanged
    restored = undo(version)
    assert restored['last_ai_update'] is None
    assert restored.get('content', restored.get('files')) == before.get('content', before.get('files'))
    with pytest.raises(HTTPException) as exc:
        undo(version)
    assert exc.value.status_code == 409


def test_manual_preview_edits_clear_undo_but_export_only_preserves_it():
    before = {
        'preview_id': 'one',
        'title': 'A',
        'entrypoint': 'index.html',
        'files': normalize_web_preview_files({'index.html': '<h1>A</h1>'}),
        'updated_at': 1,
    }
    ai = build_web_preview_document_update(
        'one',
        before,
        files={'index.html': '<h1>B</h1>'},
        source='ai',
        expected_updated_at=1,
        expected_content_hash=web_preview_content_hash(before),
    )
    exported = build_web_preview_document_update(
        'one',
        ai,
        files=ai['files'],
        update_export=True,
        exported_path='/preview',
        expected_updated_at=ai['updated_at'],
        expected_content_hash=web_preview_content_hash(ai),
    )
    assert exported['last_ai_update'] == ai['last_ai_update']
    manual = build_web_preview_document_update(
        'one',
        ai,
        files={'index.html': '<h1>Manual</h1>'},
        expected_updated_at=ai['updated_at'],
        expected_content_hash=web_preview_content_hash(ai),
    )
    assert manual['last_ai_update'] is None
