import asyncio
from contextlib import asynccontextmanager
from types import SimpleNamespace
from unittest.mock import AsyncMock

import open_webui.models.chats as chats_model
import open_webui.routers.chat_artifacts as artifacts_router
import pytest
from fastapi import HTTPException
from open_webui.models.chats import Chat, Chats
from open_webui.models.config import Config
from open_webui.models.notes import Note, NoteModel, Notes
from open_webui.routers.chat_artifacts import (
    CanvasDocumentForm,
    CanvasPromotionForm,
    promote_transient_canvas_document,
    update_transient_canvas_document,
)
from open_webui.utils.canvas import (
    CANVAS_DOCUMENTS_KEY,
    canvas_content_hash,
    detach_linked_canvases_from_note,
    sync_linked_canvases_from_note,
)
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from starlette.requests import Request


def _request() -> Request:
    return Request({'type': 'http', 'method': 'POST', 'path': '/'})


async def _database(tmp_path):
    engine = create_async_engine(f'sqlite+aiosqlite:///{tmp_path / "workspace.db"}')
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(Chat.__table__.create)
        await connection.run_sync(Note.__table__.create)
    return engine, sessions


async def _insert_chat(sessions, chat_data: dict):
    async with sessions() as session:
        session.add(
            Chat(
                id='chat-1',
                user_id='user-1',
                title='Workspace',
                chat=chat_data,
                created_at=1,
                updated_at=1,
            )
        )
        await session.commit()


def _patch_chat_sessions(monkeypatch, sessions):
    @asynccontextmanager
    async def database_context(_db=None):
        async with sessions() as session:
            yield session

    monkeypatch.setattr(chats_model, 'get_async_db_context', database_context)


def test_concurrent_chat_mutations_preserve_both_changes(monkeypatch, tmp_path):
    async def run():
        engine, sessions = await _database(tmp_path)
        try:
            await _insert_chat(sessions, {'title': 'Workspace'})
            _patch_chat_sessions(monkeypatch, sessions)

            ready = 0
            both_started = asyncio.Event()

            def mutation(key: str):
                async def mutate(chat_data, _session):
                    nonlocal ready
                    ready += 1
                    if ready == 2:
                        both_started.set()
                    await both_started.wait()
                    chat_data[key] = True
                    return chat_data, key

                return mutate

            await asyncio.gather(
                Chats.mutate_chat_by_id('chat-1', mutation('canvas'), user_id='user-1'),
                Chats.mutate_chat_by_id('chat-1', mutation('web_preview'), user_id='user-1'),
            )

            async with sessions() as session:
                persisted = await session.get(Chat, 'chat-1')
                assert persisted.chat['canvas'] is True
                assert persisted.chat['web_preview'] is True
        finally:
            await engine.dispose()

    asyncio.run(run())


def test_concurrent_canvas_full_saves_allow_exactly_one_version(monkeypatch, tmp_path):
    async def run():
        engine, sessions = await _database(tmp_path)
        try:
            original = '# Plan\n\nOriginal'
            await _insert_chat(
                sessions,
                {
                    CANVAS_DOCUMENTS_KEY: {
                        'canvas-1': {
                            'canvas_id': 'canvas-1',
                            'title': 'Plan',
                            'content': original,
                            'title_edited': True,
                            'updated_at': 10,
                        }
                    }
                },
            )
            _patch_chat_sessions(monkeypatch, sessions)

            def form(content: str) -> CanvasDocumentForm:
                return CanvasDocumentForm(
                    title='Plan',
                    content=content,
                    title_edited=True,
                    expected_updated_at=10,
                    expected_content_hash=canvas_content_hash(original),
                )

            results = await asyncio.gather(
                update_transient_canvas_document(
                    _request(),
                    'chat-1',
                    'canvas-1',
                    form('# Plan\n\nFirst'),
                    user=SimpleNamespace(id='user-1'),
                    db=None,
                ),
                update_transient_canvas_document(
                    _request(),
                    'chat-1',
                    'canvas-1',
                    form('# Plan\n\nSecond'),
                    user=SimpleNamespace(id='user-1'),
                    db=None,
                ),
                return_exceptions=True,
            )

            successes = [result for result in results if isinstance(result, dict)]
            conflicts = [result for result in results if isinstance(result, HTTPException)]
            assert len(successes) == 1
            assert len(conflicts) == 1
            assert conflicts[0].status_code == 409
            assert conflicts[0].detail['type'] == 'canvas.conflict'

            async with sessions() as session:
                persisted = await session.get(Chat, 'chat-1')
                saved = persisted.chat[CANVAS_DOCUMENTS_KEY]['canvas-1']
                assert saved['content'] in {'# Plan\n\nFirst', '# Plan\n\nSecond'}
                assert conflicts[0].detail['currentContentHash'] == canvas_content_hash(saved['content'])
        finally:
            await engine.dispose()

    asyncio.run(run())


def test_failed_canvas_promotion_rolls_back_note_and_link(monkeypatch, tmp_path):
    async def run():
        engine, sessions = await _database(tmp_path)
        try:
            await _insert_chat(
                sessions,
                {
                    CANVAS_DOCUMENTS_KEY: {
                        'canvas-1': {
                            'canvas_id': 'canvas-1',
                            'title': 'Plan',
                            'content': '# Plan',
                            'updated_at': 1,
                        }
                    }
                },
            )
            _patch_chat_sessions(monkeypatch, sessions)
            monkeypatch.setattr(Config, 'get', AsyncMock(return_value=True))

            insert_note = Notes.insert_new_note

            async def fail_after_note_flush(*args, **kwargs):
                await insert_note(*args, **kwargs)
                raise RuntimeError('chat link failed')

            monkeypatch.setattr(Notes, 'insert_new_note', fail_after_note_flush)

            with pytest.raises(RuntimeError, match='chat link failed'):
                await promote_transient_canvas_document(
                    _request(),
                    'chat-1',
                    'canvas-1',
                    CanvasPromotionForm(
                        title='Plan',
                        content='# Plan',
                        expected_updated_at=1,
                        expected_content_hash=canvas_content_hash('# Plan'),
                    ),
                    user=SimpleNamespace(id='user-1', role='admin'),
                )

            async with sessions() as session:
                assert await session.scalar(select(func.count()).select_from(Note)) == 0
                chat = await session.get(Chat, 'chat-1')
                assert 'note_id' not in chat.chat[CANVAS_DOCUMENTS_KEY]['canvas-1']
        finally:
            await engine.dispose()

    asyncio.run(run())


def test_concurrent_canvas_promotion_creates_one_note(monkeypatch, tmp_path):
    async def run():
        engine, sessions = await _database(tmp_path)
        try:
            await _insert_chat(
                sessions,
                {
                    CANVAS_DOCUMENTS_KEY: {
                        'canvas-1': {
                            'canvas_id': 'canvas-1',
                            'title': 'Plan',
                            'content': '# Plan',
                            'updated_at': 1,
                        }
                    }
                },
            )
            _patch_chat_sessions(monkeypatch, sessions)
            monkeypatch.setattr(Config, 'get', AsyncMock(return_value=True))
            monkeypatch.setattr(artifacts_router, 'publish_event', AsyncMock())

            async def get_note(note_id, db=None):
                async with sessions() as session:
                    note = await session.get(Note, note_id)
                    return NoteModel.model_validate(note) if note else None

            monkeypatch.setattr(Notes, 'get_note_by_id', get_note)

            results = await asyncio.gather(
                promote_transient_canvas_document(
                    _request(),
                    'chat-1',
                    'canvas-1',
                    CanvasPromotionForm(
                        title='Plan',
                        content='# Plan',
                        expected_updated_at=1,
                        expected_content_hash=canvas_content_hash('# Plan'),
                    ),
                    user=SimpleNamespace(id='user-1', role='admin'),
                ),
                promote_transient_canvas_document(
                    _request(),
                    'chat-1',
                    'canvas-1',
                    CanvasPromotionForm(
                        title='Plan',
                        content='# Plan',
                        expected_updated_at=1,
                        expected_content_hash=canvas_content_hash('# Plan'),
                    ),
                    user=SimpleNamespace(id='user-1', role='admin'),
                ),
                return_exceptions=True,
            )

            successes = [result for result in results if not isinstance(result, Exception)]
            conflicts = [result for result in results if isinstance(result, HTTPException)]
            assert len(successes) == 1
            assert len(conflicts) == 1
            assert conflicts[0].status_code == 409
            async with sessions() as session:
                assert await session.scalar(select(func.count()).select_from(Note)) == 1
                chat = await session.get(Chat, 'chat-1')
                assert chat.chat[CANVAS_DOCUMENTS_KEY]['canvas-1']['note_id'] == successes[0].id
        finally:
            await engine.dispose()

    asyncio.run(run())


def test_stale_canvas_promotion_does_not_create_note(monkeypatch, tmp_path):
    async def run():
        engine, sessions = await _database(tmp_path)
        try:
            await _insert_chat(
                sessions,
                {
                    CANVAS_DOCUMENTS_KEY: {
                        'canvas-1': {
                            'canvas_id': 'canvas-1',
                            'title': 'Current',
                            'content': '# Current',
                            'updated_at': 2,
                        }
                    }
                },
            )
            _patch_chat_sessions(monkeypatch, sessions)
            monkeypatch.setattr(Config, 'get', AsyncMock(return_value=True))

            with pytest.raises(HTTPException) as error:
                await promote_transient_canvas_document(
                    _request(),
                    'chat-1',
                    'canvas-1',
                    CanvasPromotionForm(
                        title='Stale',
                        content='# Stale',
                        expected_updated_at=1,
                        expected_content_hash=canvas_content_hash('# Stale'),
                    ),
                    user=SimpleNamespace(id='user-1', role='admin'),
                )

            assert error.value.status_code == 409
            assert error.value.detail['type'] == 'canvas.conflict'
            async with sessions() as session:
                assert await session.scalar(select(func.count()).select_from(Note)) == 0
                chat = await session.get(Chat, 'chat-1')
                assert chat.chat[CANVAS_DOCUMENTS_KEY]['canvas-1']['content'] == '# Current'
        finally:
            await engine.dispose()

    asyncio.run(run())


def test_note_edit_updates_linked_canvas_and_clears_ai_undo(monkeypatch, tmp_path):
    async def run():
        engine, sessions = await _database(tmp_path)
        try:
            await _insert_chat(
                sessions,
                {
                    CANVAS_DOCUMENTS_KEY: {
                        'canvas-1': {
                            'canvas_id': 'canvas-1',
                            'title': 'Old title',
                            'content': '# Old',
                            'note_id': 'note-1',
                            'last_ai_update': {'title': 'Older', 'content': '# Older'},
                            'updated_at': 3,
                        }
                    }
                },
            )
            _patch_chat_sessions(monkeypatch, sessions)

            updated = await sync_linked_canvases_from_note(
                'note-1',
                'user-1',
                'New title',
                '# New content',
            )

            assert len(updated) == 1
            async with sessions() as session:
                chat = await session.get(Chat, 'chat-1')
                document = chat.chat[CANVAS_DOCUMENTS_KEY]['canvas-1']
                assert document['title'] == 'New title'
                assert document['content'] == '# New content'
                assert document['title_edited'] is True
                assert document['last_ai_update'] is None
                assert document['updated_at'] > 3
        finally:
            await engine.dispose()

    asyncio.run(run())


def test_deleted_note_detaches_canvas_without_deleting_content(monkeypatch, tmp_path):
    async def run():
        engine, sessions = await _database(tmp_path)
        try:
            await _insert_chat(
                sessions,
                {
                    CANVAS_DOCUMENTS_KEY: {
                        'canvas-1': {
                            'canvas_id': 'canvas-1',
                            'title': 'Kept title',
                            'content': '# Kept content',
                            'note_id': 'note-1',
                            'updated_at': 3,
                        }
                    }
                },
            )
            _patch_chat_sessions(monkeypatch, sessions)

            updated = await detach_linked_canvases_from_note('note-1', 'user-1')

            assert len(updated) == 1
            async with sessions() as session:
                chat = await session.get(Chat, 'chat-1')
                document = chat.chat[CANVAS_DOCUMENTS_KEY]['canvas-1']
                assert document['note_id'] is None
                assert document['title'] == 'Kept title'
                assert document['content'] == '# Kept content'
                assert document['updated_at'] > 3
        finally:
            await engine.dispose()

    asyncio.run(run())


def test_workspace_endpoint_does_not_hide_persistence_failure(monkeypatch):
    monkeypatch.setattr(Chats, 'mutate_chat_by_id', AsyncMock(side_effect=RuntimeError('write failed')))

    with pytest.raises(RuntimeError, match='write failed'):
        asyncio.run(
            artifacts_router.select_transient_canvas_document(
                'chat-1',
                'canvas-1',
                user=SimpleNamespace(id='user-1'),
            )
        )
