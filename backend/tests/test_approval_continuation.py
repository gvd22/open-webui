import asyncio
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock

import open_webui.utils.middleware as middleware
from open_webui.utils.workspace_access import APPROVAL_FREE_WORKSPACE_TOOLS
from open_webui.utils.workspace_context import remove_workspace_context_prompts


def _tool_metadata(name, *, builtin=True):
    return {
        'tools': {
            name: {
                'type': 'builtin' if builtin else 'function',
                'tool_id': f'builtin:{name}' if builtin else f'user:{name}',
            }
        }
    }


def test_chat_local_canvas_and_preview_builtins_do_not_require_approval():
    for name in APPROVAL_FREE_WORKSPACE_TOOLS:
        assert middleware.tool_requires_approval(name, _tool_metadata(name)) is False


def test_approval_bypass_rejects_spoofed_and_runtime_tools():
    assert middleware.tool_requires_approval(
        'canvas_update_document',
        _tool_metadata('canvas_update_document', builtin=False),
    ) is True
    assert middleware.tool_requires_approval(
        'web_preview_import_runtime_file',
        _tool_metadata('web_preview_import_runtime_file'),
    ) is True


def test_mixed_batch_auto_queues_workspace_builtin_but_prompts_for_other_tool(monkeypatch):
    async def run():
        saved = {}

        async def upsert(_chat_id, _message_id, payload, **_kwargs):
            saved.update(payload)

        monkeypatch.setattr(
            middleware.Chats,
            'upsert_message_to_chat_by_id_and_message_id',
            upsert,
        )
        output = [
            {
                'type': 'function_call',
                'call_id': 'canvas-call',
                'name': 'canvas_update_document',
                'status': 'in_progress',
            },
            {
                'type': 'function_call',
                'call_id': 'terminal-call',
                'name': 'terminal_execute',
                'status': 'in_progress',
            },
        ]
        metadata = {
            'tools': {
                'canvas_update_document': {
                    'type': 'builtin',
                    'tool_id': 'builtin:canvas_update_document',
                },
                'terminal_execute': {
                    'type': 'builtin',
                    'tool_id': 'builtin:terminal_execute',
                },
            }
        }
        await middleware.pause_for_tool_approval('chat', 'message', output, {}, metadata)
        return saved['output']

    output = asyncio.run(run())
    assert output[0]['status'] == 'queued'
    assert output[0]['approved'] is True
    assert output[1]['status'] == 'pending'
    assert output[1].get('approved') is not True


def test_continuation_replay_can_keep_full_current_turn_workspace_output():
    output = [
        {
            'type': 'function_call',
            'call_id': 'create-a',
            'name': 'canvas_create_document',
            'arguments': json.dumps({'content': 'first document body', 'title': 'First'}),
            'status': 'completed',
        },
        {
            'type': 'function_call_output',
            'call_id': 'create-a',
            'output': [{'type': 'input_text', 'text': '{"type":"canvas.document","canvasId":"canvas-a"}'}],
        },
        {
            'type': 'function_call',
            'call_id': 'create-b',
            'name': 'canvas_create_document',
            'arguments': json.dumps({'content': 'second document body', 'title': 'Second'}),
            'status': 'completed',
        },
        {
            'type': 'function_call_output',
            'call_id': 'create-b',
            'output': [{'type': 'input_text', 'text': '{"type":"canvas.document","canvasId":"canvas-b"}'}],
        },
    ]

    messages = middleware.process_messages_with_output(
        [{'role': 'assistant', 'output': output}],
        preserve_workspace_output=True,
    )

    serialized = json.dumps(messages)
    assert 'first document body' in serialized
    assert 'second document body' in serialized


def test_approval_drain_preserves_output_and_rebuilds_fresh_workspace_context(monkeypatch):
    async def run():
        chat_data = {'before_execution': True}
        state = {
            'output': [
                {
                    'type': 'function_call',
                    'call_id': 'create-a',
                    'name': 'canvas_create_document',
                    'arguments': '{"content":"created body","title":"Created"}',
                    'status': 'queued',
                    'approved': True,
                }
            ]
        }

        async def get_message(*_args):
            return {'role': 'assistant', 'model': 'model', 'output': state['output']}

        async def execute(*_args, **_kwargs):
            chat_data['after_execution'] = True
            return {'tool_call_id': 'create-a', 'content': 'created'}

        workspace_calls = []

        def build_workspace(chat, focus, model, form_data, tools):
            workspace_calls.append((chat, focus, form_data['messages'], tools))
            return '[CANVAS CONTEXT]\nfresh workspace state'

        monkeypatch.setattr(middleware, 'is_saved_chat_id', lambda value: value == 'chat-1')
        monkeypatch.setattr(middleware.Chats, 'get_message_by_id_and_message_id', get_message)
        monkeypatch.setattr(
            middleware,
            'claim_approved_tool_calls',
            AsyncMock(return_value=(state['output'], [state['output'][0]], False)),
        )
        monkeypatch.setattr(middleware, 'get_event_emitter_and_caller', AsyncMock(return_value=(None, None)))
        monkeypatch.setattr(middleware, 'execute_tool_call_for_output', execute)
        monkeypatch.setattr(middleware, 'get_filter_functions', AsyncMock(return_value=[]))
        monkeypatch.setattr(middleware.Chats, 'upsert_message_to_chat_by_id_and_message_id', AsyncMock())
        monkeypatch.setattr(
            middleware,
            'load_messages_from_db',
            AsyncMock(
                return_value=[
                    {'id': 'user-1', 'role': 'user', 'content': 'create two documents'},
                ]
            ),
        )
        monkeypatch.setattr(
            middleware.Chats,
            'get_chat_by_id_and_user_id',
            AsyncMock(return_value=SimpleNamespace(chat=chat_data)),
        )
        monkeypatch.setattr(middleware, 'build_workspace_context_prompt', build_workspace)

        form_data = {
            'messages': [
                {'role': 'system', 'content': 'base system\n[CANVAS CONTEXT]\nstale workspace state'},
                {'role': 'user', 'content': 'create two documents'},
            ],
        }
        metadata = {
            'chat_id': 'chat-1',
            'message_id': 'assistant-1',
            'assistant_message_id': 'assistant-1',
            'user_message_id': 'user-1',
            'workspace_focus': {'kind': 'canvas', 'id': 'original-target'},
            'tools': {'canvas_create_document': {'spec': {}}},
            'params': {},
        }

        paused = await middleware.drain_approved_tool_calls(
            SimpleNamespace(),
            form_data,
            SimpleNamespace(id='owner'),
            {'id': 'model'},
            metadata,
        )
        return paused, chat_data, workspace_calls, form_data['messages'], state['output']

    paused, chat_data, workspace_calls, messages, output = asyncio.run(run())

    assert paused is False
    assert chat_data['after_execution'] is True
    assert workspace_calls[0][0]['after_execution'] is True
    assert workspace_calls[0][1] == {'kind': 'canvas', 'id': 'original-target'}
    system_content = messages[0]['content']
    assert 'base system' in system_content
    assert 'stale workspace state' not in system_content
    assert 'fresh workspace state' in system_content
    serialized = json.dumps(messages)
    assert 'created body' in serialized
    assert output[0]['arguments'] == '{"content":"created body","title":"Created"}'


def test_remove_workspace_context_prompts_keeps_non_workspace_system_content():
    messages = [
        {
            'role': 'system',
            'content': 'policy\n[WEB PREVIEW ROUTING]\nUse the preview.\n[CANVAS CONTEXT]\nold state',
        },
        {'role': 'user', 'content': 'continue'},
    ]

    cleaned = remove_workspace_context_prompts(messages)

    assert cleaned == [
        {'role': 'system', 'content': 'policy'},
        {'role': 'user', 'content': 'continue'},
    ]


def test_legacy_streaming_accepts_null_builtin_tools_metadata(monkeypatch):
    class EmptyResponse:
        headers = {'Content-Type': 'text/event-stream'}
        background = None

        async def body_iterator(self):
            if False:
                yield b''

    async def run():
        monkeypatch.setattr(middleware, 'get_system_oauth_token', AsyncMock(return_value=None))
        monkeypatch.setattr(middleware, 'get_filter_functions', AsyncMock(return_value=[]))
        monkeypatch.setattr(middleware.Config, 'get', AsyncMock(return_value=True))
        monkeypatch.setattr(middleware, 'clear_response_stream', AsyncMock())
        monkeypatch.setattr(middleware, 'publish_chat_finished_event', AsyncMock())
        monkeypatch.setattr(middleware, 'outlet_filter_handler', AsyncMock())
        monkeypatch.setattr(middleware, 'background_tasks_handler', AsyncMock())

        request = SimpleNamespace(
            state=SimpleNamespace(max_tool_call_iterations=0),
            app=SimpleNamespace(state=SimpleNamespace(redis=None)),
        )
        events = []

        async def event_emitter(event):
            events.append(event)

        ctx = {
            'request': request,
            'form_data': {'messages': [{'role': 'user', 'content': 'hello'}], 'model': 'model'},
            'user': SimpleNamespace(id='user', role='admin'),
            'model': {
                'id': 'model',
                'info': {'meta': {'builtinTools': None, 'capabilities': {'code_interpreter': True}}},
            },
            'metadata': {
                'chat_id': '',
                'message_id': '',
                'params': {'function_calling': 'legacy'},
                'features': {'code_interpreter': True},
            },
            'events': [],
            'event_emitter': event_emitter,
            'event_caller': None,
        }

        response = EmptyResponse()
        response.body_iterator = response.body_iterator()
        await middleware.streaming_chat_response_handler(response, ctx)

    asyncio.run(run())


def test_concurrent_drain_does_not_recover_active_tool_call(monkeypatch):
    async def run():
        output = [
            {
                'type': 'function_call',
                'call_id': 'call-1',
                'name': 'web_preview_replace_text',
                'status': 'in_progress',
                'execution_started': True,
            },
        ]

        monkeypatch.setattr(middleware, 'is_saved_chat_id', lambda value: value == 'chat-1')
        monkeypatch.setattr(
            middleware.Chats,
            'get_message_by_id_and_message_id',
            AsyncMock(return_value={'output': [output[0]]}),
        )
        results = await asyncio.gather(
            *[
                middleware.drain_approved_tool_calls(
                    SimpleNamespace(),
                    {'messages': []},
                    SimpleNamespace(id='owner'),
                    {'id': 'model'},
                    {
                        'chat_id': 'chat-1',
                        'message_id': 'assistant-1',
                        'assistant_message_id': 'assistant-1',
                    },
                )
                for _ in range(2)
            ]
        )

        assert results == [True, True]
        assert output[0]['status'] == 'in_progress'
        assert output[0]['execution_started'] is True

    asyncio.run(run())
