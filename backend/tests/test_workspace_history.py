import json
import pytest

from open_webui.utils.workspace_context import (
    build_cancelled_workspace_output_update,
    compact_workspace_tool_output,
)


def _tool_output(name: str, arguments: dict, result: dict) -> list[dict]:
    return [
        {
            'type': 'function_call',
            'call_id': 'call-1',
            'name': name,
            'arguments': json.dumps(arguments),
        },
        {
            'type': 'function_call_output',
            'call_id': 'call-1',
            'output': [{'type': 'input_text', 'text': json.dumps(result)}],
        },
    ]


def test_canvas_history_keeps_reference_without_document_content():
    output = _tool_output(
        'canvas_update_document',
        {'canvas_id': 'canvas-1', 'content': 'large private body', 'title': 'Plan'},
        {
            'type': 'canvas.document',
            'canvasId': 'canvas-1',
            'title': 'Plan',
            'content': {'md': 'large private body'},
            'contentHash': 'abc',
        },
    )

    compact = compact_workspace_tool_output(output)

    assert 'large private body' not in json.dumps(compact)
    assert 'large private body' in json.dumps(output)
    assert json.loads(compact[0]['arguments']) == {'canvas_id': 'canvas-1', 'title': 'Plan'}
    result = json.loads(compact[1]['output'][0]['text'])
    assert result == {
        'type': 'canvas.document',
        'canvasId': 'canvas-1',
        'title': 'Plan',
        'contentHash': 'abc',
        'contentOmitted': True,
    }


def test_read_excerpt_is_available_for_current_turn_but_compact_in_history():
    output = _tool_output(
        'web_preview_read_file',
        {'preview_id': 'preview-1', 'path': 'index.html', 'start_line': 1, 'end_line': 50},
        {
            'type': 'web_preview.file_excerpt',
            'previewId': 'preview-1',
            'path': 'index.html',
            'content': '<main>large body</main>',
            'contentHash': 'def',
        },
    )

    compact = compact_workspace_tool_output(output)

    assert '<main>large body</main>' not in json.dumps(compact)
    assert json.loads(compact[0]['arguments']) == {
        'preview_id': 'preview-1',
        'path': 'index.html',
        'start_line': 1,
        'end_line': 50,
    }
    assert json.loads(compact[1]['output'][0]['text'])['contentOmitted'] is True


def test_non_workspace_output_is_not_copied_or_changed():
    output = _tool_output('search_web', {'query': 'canvas'}, {'content': 'result'})

    assert compact_workspace_tool_output(output) is output


@pytest.mark.parametrize('status', ['in_progress', 'completed', 'pending', 'queued'])
def test_unexecuted_workspace_calls_keep_full_arguments_for_approval(status):
    output = _tool_output('web_preview_create',
        {'title': 'Dashboard', 'files': {'index.html': {'content': '<main>Original</main>'}}},
        {'type': 'web_preview.document'})[:1]
    output[0]['status'] = status
    assert compact_workspace_tool_output(output) is output
    assert json.loads(output[0]['arguments'])['files']['index.html']['content'] == '<main>Original</main>'


def test_cancelled_workspace_stream_persists_compact_output_for_both_save_modes():
    output = _tool_output(
        'canvas_update_document',
        {'canvas_id': 'canvas-1', 'content': 'raw workspace body'},
        {'type': 'canvas.document', 'canvasId': 'canvas-1', 'content': 'raw workspace body'},
    )

    for realtime in (False, True):
        update = build_cancelled_workspace_output_update(output, realtime=realtime)
        assert update['done'] is True
        assert 'raw workspace body' not in json.dumps(update)
        assert update['output'][0]['type'] == 'function_call'
