import asyncio
from contextlib import asynccontextmanager
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

import open_webui.models.chats as chats_model
import open_webui.models.chat_messages as messages_model
import open_webui.utils.tool_approval as approval
from open_webui.models.chats import Chat, Chats
from open_webui.models.chat_messages import ChatMessage


async def setup_database(tmp_path, monkeypatch, tool='canvas_update_document'):
    engine = create_async_engine(f'sqlite+aiosqlite:///{tmp_path / "approval.db"}')
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(Chat.__table__.create)
        await connection.run_sync(ChatMessage.__table__.create)

    @asynccontextmanager
    async def context(db=None):
        if db is not None:
            yield db
        else:
            async with sessions() as session:
                yield session

    monkeypatch.setattr(chats_model, 'get_async_db_context', context)
    monkeypatch.setattr(messages_model, 'get_async_db_context', context)
    monkeypatch.setattr(approval, 'get_event_emitter', AsyncMock(return_value=None))
    message = {
        'id': 'assistant', 'role': 'assistant', 'model': 'test-model', 'parentId': 'user',
        'meta': {'workspace_focus': {'kind': 'canvas', 'id': 'original'},
                 'workspace_file': {'path': '/workspace/original.csv'}, 'terminal_id': 'original-terminal',
                 'session_id': 'stale-browser-session'},
        'output': [{'type': 'function_call', 'call_id': 'call', 'name': tool,
                    'arguments': '{"canvas_id":"original","expected_updated_at":10}', 'status': 'pending'}],
        'done': False,
    }
    async with sessions() as session:
        session.add(Chat(id='chat', user_id='owner', title='Approval', created_at=1, updated_at=1,
                         chat={'history': {'messages': {'assistant': message,
                               'user': {'id': 'user', 'role': 'user', 'content': 'Update it'}}}}))
        await session.commit()
    return engine, sessions


def test_concurrent_approval_and_execution_claim_are_single_winner(tmp_path, monkeypatch):
    async def run():
        engine, sessions = await setup_database(tmp_path, monkeypatch)
        try:
            user = SimpleNamespace(id='owner', role='user')
            form = approval.ResolveToolCallForm(call_id='call', action='approve')
            results = await asyncio.gather(*[
                approval.resolve_tool_call_output('chat', 'assistant', form, user) for _ in range(2)
            ], return_exceptions=True)
            assert sum(isinstance(result, dict) for result in results) == 1
            assert next(result for result in results if isinstance(result, HTTPException)).status_code == 409
            claims = await asyncio.gather(*[
                approval.claim_approved_tool_calls('chat', 'assistant', 'owner') for _ in range(2)
            ])
            assert sum(len(calls) for _, calls, _ in claims) == 1
            assert sum(blocked for _, _, blocked in claims) == 1
            async with sessions() as session:
                chat = await session.get(Chat, 'chat')
                row = await session.get(ChatMessage, 'chat-assistant')
                assert row.output == chat.chat['history']['messages']['assistant']['output']
                assert row.output[0]['status'] == 'in_progress'
                assert row.output[0]['arguments'] == form_args
            with pytest.raises(HTTPException) as exc:
                await approval.resolve_tool_call_output('chat', 'assistant', form, user)
            assert exc.value.status_code == 409
            assert exc.value.detail == 'Tool call is already running; it was not retried.'
            # A later retry (including after a process restart) must not execute it again.
            assert (await approval.claim_approved_tool_calls('chat', 'assistant', 'owner'))[2] is True
        finally:
            await engine.dispose()
    form_args = '{"canvas_id":"original","expected_updated_at":10}'
    asyncio.run(run())


@pytest.mark.parametrize('action,tool', [('reject', 'canvas_update_document'), ('answer', 'ask_user')])
def test_resolution_is_durable_and_cannot_be_repeated(tmp_path, monkeypatch, action, tool):
    async def run():
        engine, _ = await setup_database(tmp_path, monkeypatch, tool)
        try:
            user = SimpleNamespace(id='owner', role='user')
            form = approval.ResolveToolCallForm(call_id='call', action=action, answers={'choice': 'yes'})
            await approval.resolve_tool_call_output('chat', 'assistant', form, user)
            message = await Chats.get_message_by_id_and_message_id('chat', 'assistant')
            assert len(message['output']) == 2
            assert message['output'][1]['call_id'] == 'call'
            with pytest.raises(HTTPException) as exc:
                await approval.resolve_tool_call_output('chat', 'assistant', form, user)
            assert exc.value.status_code == 409
        finally:
            await engine.dispose()
    asyncio.run(run())


def test_resume_preserves_original_workspace_context(tmp_path, monkeypatch):
    async def run():
        engine, _ = await setup_database(tmp_path, monkeypatch)
        try:
            await Chats.mutate_chat_by_id('chat', lambda data, _: (
                {**data, 'canvas_active_document_id': 'other'}, None))
            payload = await approval.build_tool_approval_resume_payload('chat', 'assistant')
            assert payload['workspace_focus'] == {'kind': 'canvas', 'id': 'original'}
            assert payload['workspace_file'] == {'path': '/workspace/original.csv'}
            assert payload['terminal_id'] == 'original-terminal'
            with pytest.raises(HTTPException) as exc:
                await approval.resolve_tool_call_output(
                    'chat', 'assistant', approval.ResolveToolCallForm(call_id='call', action='approve'),
                    SimpleNamespace(id='other', role='user'))
            assert exc.value.status_code == 401
        finally:
            await engine.dispose()
    asyncio.run(run())


def test_resume_preserves_explicit_empty_file_snapshot(tmp_path, monkeypatch):
    async def run():
        engine, _ = await setup_database(tmp_path, monkeypatch)
        try:
            await Chats.mutate_chat_by_id(
                'chat',
                lambda data, _: ({**data, 'files': [{'id': 'added-after-approval'}]}, None),
            )
            def preserve_empty_files(message):
                message['meta'] = {**message.get('meta', {}), 'files': []}

            await Chats.mutate_message_by_id('chat', 'assistant', preserve_empty_files, user_id='owner')

            payload = await approval.build_tool_approval_resume_payload('chat', 'assistant')

            assert payload['files'] == []
        finally:
            await engine.dispose()

    asyncio.run(run())


def test_resume_preserves_original_session_without_explicit_socket(tmp_path, monkeypatch):
    async def run():
        engine, _ = await setup_database(tmp_path, monkeypatch)
        try:
            monkeypatch.setattr(
                approval,
                'SESSION_POOL',
                {
                    'current-browser-session': {'id': 'owner', 'last_seen_at': 20},
                    'other-browser-session': {'id': 'owner', 'last_seen_at': 10},
                    'foreign-session': {'id': 'other', 'last_seen_at': 30},
                },
            )

            payload = await approval.build_tool_approval_resume_payload('chat', 'assistant')

            assert payload['session_id'] == 'stale-browser-session'
            assert payload['workspace_focus'] == {'kind': 'canvas', 'id': 'original'}
            assert payload['terminal_id'] == 'original-terminal'
        finally:
            await engine.dispose()

    asyncio.run(run())


def test_resolution_rebinds_to_explicit_owned_socket_from_reloaded_tab(tmp_path, monkeypatch):
    async def run():
        engine, _ = await setup_database(tmp_path, monkeypatch)
        try:
            monkeypatch.setattr(
                approval,
                'SESSION_POOL',
                {
                    'current-browser-session': {'id': 'owner'},
                    'other-browser-session': {'id': 'owner'},
                },
            )
            user = SimpleNamespace(id='owner', role='user')
            await approval.resolve_tool_call_output(
                'chat',
                'assistant',
                approval.ResolveToolCallForm(
                    call_id='call', action='approve', session_id='current-browser-session'
                ),
                user,
            )

            payload = await approval.build_tool_approval_resume_payload('chat', 'assistant')
            assert payload['session_id'] == 'current-browser-session'
            assert payload['workspace_focus'] == {'kind': 'canvas', 'id': 'original'}
            assert payload['terminal_id'] == 'original-terminal'
            message = await Chats.get_message_by_id_and_message_id('chat', 'assistant')
            assert message['meta']['session_id'] == 'current-browser-session'
        finally:
            await engine.dispose()

    asyncio.run(run())


def test_foreign_explicit_socket_is_rejected_without_resolution_mutation(tmp_path, monkeypatch):
    async def run():
        engine, _ = await setup_database(tmp_path, monkeypatch)
        try:
            monkeypatch.setattr(approval, 'SESSION_POOL', {'foreign-session': {'id': 'other'}})
            user = SimpleNamespace(id='owner', role='user')
            with pytest.raises(HTTPException) as exc:
                await approval.resolve_tool_call_output(
                    'chat',
                    'assistant',
                    approval.ResolveToolCallForm(call_id='call', action='approve', session_id='foreign-session'),
                    user,
                )
            assert exc.value.status_code == 403

            message = await Chats.get_message_by_id_and_message_id('chat', 'assistant')
            assert message['output'][0]['status'] == 'pending'
            assert message['meta']['session_id'] == 'stale-browser-session'
        finally:
            await engine.dispose()

    asyncio.run(run())


def test_interrupted_execution_remains_claimed_without_replay(tmp_path, monkeypatch):
    async def run():
        engine, sessions = await setup_database(tmp_path, monkeypatch)
        try:
            user = SimpleNamespace(id='owner', role='user')
            await approval.resolve_tool_call_output(
                'chat', 'assistant', approval.ResolveToolCallForm(call_id='call', action='approve'), user
            )
            await approval.claim_approved_tool_calls('chat', 'assistant', user.id)

            output, calls, already_running = await approval.claim_approved_tool_calls('chat', 'assistant', user.id)
            assert calls == []
            assert already_running is True
            assert output[0]['status'] == 'in_progress'
            assert len(output) == 1
            async with sessions() as session:
                row = await session.get(ChatMessage, 'chat-assistant')
                assert len(row.output) == 1
                assert row.output[0]['execution_started'] is True
        finally:
            await engine.dispose()

    asyncio.run(run())
