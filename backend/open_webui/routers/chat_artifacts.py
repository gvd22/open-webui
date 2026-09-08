import logging

from fastapi import APIRouter, Depends, HTTPException, Request, status
from open_webui.constants import ERROR_MESSAGES
from open_webui.events import EVENTS, publish_event
from open_webui.internal.db import get_async_session
from open_webui.models.chats import Chats
from open_webui.models.config import Config
from open_webui.models.files import File
from open_webui.models.notes import Note, NoteForm, Notes
from open_webui.socket.main import sio
from open_webui.utils.access_control import has_permission
from open_webui.utils.auth import get_verified_user
from open_webui.utils.canvas import (
    CANVAS_DOCUMENTS_KEY,
    CanvasConflictError,
    build_canvas_document_update,
    build_canvas_note_content,
    canvas_content_hash,
    canvas_timestamp,
    linked_canvas_note_exists,
    require_canvas_precondition,
    set_active_canvas_document,
    sync_linked_canvas_note_content,
)
from open_webui.utils.web_preview import (
    WEB_PREVIEW_DOCUMENTS_KEY,
    WebPreviewConflictError,
    build_web_preview_document_update,
    set_active_web_preview,
    web_preview_content_hash,
)
from open_webui.utils.workspace_outputs import (
    WORKSPACE_OUTPUTS_KEY,
    merge_workspace_outputs,
)
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

log = logging.getLogger(__name__)
router = APIRouter()


class CanvasDocumentForm(BaseModel):
    """User-authored edits for one transient Canvas document in a chat."""

    title: str
    content: str
    title_edited: bool = False
    expected_updated_at: int | None = None
    expected_content_hash: str | None = None


class CanvasPromotionForm(BaseModel):
    title: str
    content: str
    html: str | None = None
    json: dict | None = None
    expected_updated_at: int | None = None
    expected_content_hash: str | None = None


class WebPreviewDocumentForm(BaseModel):
    title: str
    entrypoint: str = 'index.html'
    files: dict
    exported_path: str | None = None
    exported_runtime: str | None = None
    expected_updated_at: int | None = None
    expected_content_hash: str | None = None


class WorkspaceOutputMutationForm(BaseModel):
    upsert: list[dict] = Field(default_factory=list, max_length=100)
    remove: list[str] = Field(default_factory=list, max_length=100)


async def _resolve_workspace_output_upserts(
    candidates: list[dict], chat_id: str, user_id: str, db: AsyncSession
) -> list[dict]:
    resolved = []
    for candidate in candidates:
        item = dict(candidate)
        file_id = item.get('fileId')
        if file_id:
            if not isinstance(file_id, str):
                raise ValueError('Invalid workspace output file ID.')
            result = await db.execute(select(File).filter_by(id=file_id, user_id=user_id))
            file = result.scalars().first()
            if file is None:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail='Workspace output file not found.',
                )
            meta = file.meta or {}
            raw_size = meta.get('size')
            size = raw_size if isinstance(raw_size, int) and not isinstance(raw_size, bool) else 0
            item.update(
                {
                    'fileId': file.id,
                    'contentType': meta.get('content_type') or 'application/octet-stream',
                    'size': max(0, size),
                    'originChatId': chat_id,
                }
            )
        resolved.append(item)
    return resolved


def _workspace_output_snapshot_ref(item: dict, chat_id: str) -> dict:
    return {
        'type': 'file',
        'id': item['fileId'],
        'url': item['fileId'],
        'name': item['name'],
        'content_type': item.get('contentType'),
        'size': item.get('size'),
        'status': 'uploaded',
        'source': 'workspace-output',
        'workspace_path': item['path'],
        'origin_chat_id': chat_id,
        **({'origin_message_id': item['messageId']} if item.get('messageId') else {}),
    }


def _sync_workspace_output_file_refs(chat_data: dict, files: list[dict], chat_id: str):
    output_paths = {item['path'] for item in files if item.get('fileId')}
    message_by_path = {item['path']: item.get('messageId') for item in files if item.get('fileId')}
    snapshot_refs = {
        item['path']: _workspace_output_snapshot_ref(item, chat_id) for item in files if item.get('fileId')
    }
    raw_chat_files = chat_data.get('files')
    existing_chat_files = [
        item
        for item in (raw_chat_files if isinstance(raw_chat_files, list) else [])
        if not (
            isinstance(item, dict)
            and item.get('source') == 'workspace-output'
            and item.get('workspace_path') not in output_paths
        )
    ]
    by_workspace_path = {
        item.get('workspace_path'): item
        for item in existing_chat_files
        if isinstance(item, dict) and item.get('source') == 'workspace-output'
    }
    by_workspace_path.update(snapshot_refs)
    chat_data['files'] = [
        item
        for item in existing_chat_files
        if not (isinstance(item, dict) and item.get('source') == 'workspace-output')
    ] + list(by_workspace_path.values())

    history = chat_data.get('history')
    raw_history_messages = history.get('messages') if isinstance(history, dict) else None
    history_messages = raw_history_messages if isinstance(raw_history_messages, dict) else {}
    for message_id, message in history_messages.items():
        if isinstance(message, dict):
            raw_message_files = message.get('files')
            message['files'] = [
                existing
                for existing in (raw_message_files if isinstance(raw_message_files, list) else [])
                if not (
                    isinstance(existing, dict)
                    and existing.get('source') == 'workspace-output'
                    and (
                        existing.get('workspace_path') not in output_paths
                        or message_by_path.get(existing.get('workspace_path')) != message_id
                    )
                )
            ]
    for item in files:
        message_id = item.get('messageId')
        ref = snapshot_refs.get(item['path'])
        message = history_messages.get(message_id)
        if not ref or not isinstance(message, dict):
            continue
        raw_message_files = message.get('files')
        message_files = [
            existing
            for existing in (raw_message_files if isinstance(raw_message_files, list) else [])
            if not (
                isinstance(existing, dict)
                and existing.get('source') == 'workspace-output'
                and existing.get('workspace_path') == item['path']
            )
        ]
        message['files'] = [*message_files, ref]


@router.post('/{id}/workspace-outputs')
async def update_workspace_outputs(
    id: str,
    form_data: WorkspaceOutputMutationForm,
    user=Depends(get_verified_user),
    db: AsyncSession = Depends(get_async_session),
):
    """Atomically update the output catalog stored with one chat."""

    async def mutate(chat_data: dict, session: AsyncSession):
        upsert = await _resolve_workspace_output_upserts(form_data.upsert, id, user.id, session)
        files = merge_workspace_outputs(
            chat_data.get(WORKSPACE_OUTPUTS_KEY),
            upsert,
            form_data.remove,
        )
        if files:
            chat_data[WORKSPACE_OUTPUTS_KEY] = files
        else:
            chat_data.pop(WORKSPACE_OUTPUTS_KEY, None)
        _sync_workspace_output_file_refs(chat_data, files, id)
        return chat_data, files

    try:
        mutation = await Chats.mutate_chat_by_id(id, mutate, user_id=user.id, db=db, touch=False)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    if mutation is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=ERROR_MESSAGES.NOT_FOUND)
    return {'files': mutation[1]}


@router.post('/{id}/web-preview/{preview_id}')
async def update_transient_web_preview(
    id: str,
    preview_id: str,
    form_data: WebPreviewDocumentForm,
    user=Depends(get_verified_user),
    db: AsyncSession = Depends(get_async_session),
):
    """Persist direct edits to a chat-scoped Web Preview."""

    def mutate(chat_data: dict, _session: AsyncSession):
        documents = dict(chat_data.get(WEB_PREVIEW_DOCUMENTS_KEY) or {})
        current = documents.get(preview_id)
        if not current:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail='Web Preview not found in this chat.',
            )
        updated = build_web_preview_document_update(
            preview_id,
            current,
            files=form_data.files,
            title=form_data.title,
            entrypoint=form_data.entrypoint,
            exported_path=form_data.exported_path,
            exported_runtime=form_data.exported_runtime,
            update_export=True,
            expected_updated_at=form_data.expected_updated_at,
            expected_content_hash=form_data.expected_content_hash,
        )
        documents[preview_id] = updated
        chat_data[WEB_PREVIEW_DOCUMENTS_KEY] = documents
        return set_active_web_preview(chat_data, preview_id), updated

    try:
        mutation = await Chats.mutate_chat_by_id(id, mutate, user_id=user.id, db=db, touch=False)
    except WebPreviewConflictError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=exc.payload) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    if mutation is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=ERROR_MESSAGES.NOT_FOUND)
    _, updated = mutation
    return {'previewId': preview_id, **updated, 'contentHash': web_preview_content_hash(updated)}


@router.post('/{id}/web-preview/{preview_id}/select')
async def select_transient_web_preview(
    id: str,
    preview_id: str,
    user=Depends(get_verified_user),
    db: AsyncSession = Depends(get_async_session),
):
    """Select a Web Preview and return its canonical current state."""

    def mutate(chat_data: dict, _session: AsyncSession):
        document = (chat_data.get(WEB_PREVIEW_DOCUMENTS_KEY) or {}).get(preview_id)
        if not document:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail='Web Preview not found in this chat.',
            )
        return set_active_web_preview(chat_data, preview_id), document

    mutation = await Chats.mutate_chat_by_id(id, mutate, user_id=user.id, db=db, touch=False)
    if mutation is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=ERROR_MESSAGES.NOT_FOUND)
    _, document = mutation
    return {'previewId': preview_id, **document, 'contentHash': web_preview_content_hash(document)}


@router.post('/{id}/canvas/{canvas_id}/undo-ai')
async def undo_last_canvas_ai_update(
    request: Request,
    id: str,
    canvas_id: str,
    user=Depends(get_verified_user),
    db: AsyncSession = Depends(get_async_session),
):
    """Restore exactly the state before the most recent Canvas tool update."""

    async def mutate(chat_data: dict, session: AsyncSession):
        documents = dict(chat_data.get(CANVAS_DOCUMENTS_KEY) or {})
        document = documents.get(canvas_id)
        if not document:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail='Canvas document not found in this chat.',
            )
        previous = document.get('last_ai_update')
        if not isinstance(previous, dict):
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail='No AI Canvas update to undo.')
        restored_document = {
            **document,
            'title': previous.get('title', document.get('title', '')),
            'content': previous.get('content', document.get('content', '')),
            'title_edited': bool(previous.get('title_edited', False)),
            'last_ai_update': None,
            'updated_at': canvas_timestamp(document.get('updated_at')),
        }
        sync = await sync_linked_canvas_note_content(
            restored_document.get('note_id'),
            user.id,
            restored_document['content'],
            db=session,
            title=restored_document['title'],
            commit=False,
        )
        if sync.stale_link:
            restored_document['note_id'] = None
        documents[canvas_id] = restored_document
        chat_data[CANVAS_DOCUMENTS_KEY] = documents
        return set_active_canvas_document(chat_data, canvas_id), {
            'document': restored_document,
            'note': sync.note,
        }

    mutation = await Chats.mutate_chat_by_id(id, mutate, user_id=user.id, db=db, touch=False)
    if mutation is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=ERROR_MESSAGES.NOT_FOUND)
    _, result = mutation
    restored_document = result['document']
    updated_note = result['note']
    if updated_note:
        try:
            await sio.emit('events:note', updated_note.model_dump(), to=f'note:{updated_note.id}')
            await publish_event(
                request,
                EVENTS.NOTE_UPDATED,
                actor=user,
                subject_id=updated_note.id,
                data={'title': updated_note.title},
            )
        except Exception:
            log.exception('Unable to publish reverted Canvas Note event canvas_id=%s', canvas_id)

    return {
        'canvasId': canvas_id,
        **restored_document,
        'contentHash': canvas_content_hash(restored_document.get('content', '')),
    }


@router.post('/{id}/canvas/{canvas_id}')
async def update_transient_canvas_document(
    request: Request,
    id: str,
    canvas_id: str,
    form_data: CanvasDocumentForm,
    user=Depends(get_verified_user),
    db: AsyncSession = Depends(get_async_session),
):
    """Persist a direct edit without promoting the Canvas to a Note."""

    async def mutate(chat_data: dict, session: AsyncSession):
        documents = dict(chat_data.get(CANVAS_DOCUMENTS_KEY) or {})
        document = documents.get(canvas_id)
        if not document:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail='Canvas document not found in this chat.',
            )
        updated_document = build_canvas_document_update(
            canvas_id,
            document,
            content=form_data.content,
            title=form_data.title,
            title_edited=form_data.title_edited,
            expected_updated_at=form_data.expected_updated_at,
            expected_content_hash=form_data.expected_content_hash,
            source='manual',
        )
        sync = await sync_linked_canvas_note_content(
            updated_document.get('note_id'),
            user.id,
            updated_document['content'],
            db=session,
            title=updated_document['title'],
            commit=False,
        )
        if sync.stale_link:
            updated_document['note_id'] = None
        documents[canvas_id] = updated_document
        chat_data[CANVAS_DOCUMENTS_KEY] = documents
        return set_active_canvas_document(chat_data, canvas_id), {
            'document': updated_document,
            'note': sync.note,
        }

    try:
        mutation = await Chats.mutate_chat_by_id(id, mutate, user_id=user.id, db=db, touch=False)
    except CanvasConflictError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=exc.payload) from exc
    if mutation is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=ERROR_MESSAGES.NOT_FOUND)
    _, result = mutation
    updated_document = result['document']
    updated_note = result['note']
    if updated_note:
        try:
            await sio.emit('events:note', updated_note.model_dump(), to=f'note:{updated_note.id}')
            await publish_event(
                request,
                EVENTS.NOTE_UPDATED,
                actor=user,
                subject_id=updated_note.id,
                data={'title': updated_note.title},
            )
        except Exception:
            log.exception('Unable to publish linked Canvas Note event canvas_id=%s', canvas_id)

    return {
        'canvasId': canvas_id,
        **updated_document,
        'contentHash': canvas_content_hash(updated_document.get('content', '')),
    }


@router.post('/{id}/canvas/{canvas_id}/select')
async def select_transient_canvas_document(
    id: str,
    canvas_id: str,
    user=Depends(get_verified_user),
    db: AsyncSession = Depends(get_async_session),
):
    """Select a transient Canvas and return its canonical current state."""

    async def mutate(chat_data: dict, session: AsyncSession):
        documents = dict(chat_data.get(CANVAS_DOCUMENTS_KEY) or {})
        document = documents.get(canvas_id)
        if not document:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail='Canvas document not found in this chat.',
            )
        if document.get('note_id') and not await linked_canvas_note_exists(
            document.get('note_id'), user.id, db=session
        ):
            document = {
                **document,
                'note_id': None,
                'updated_at': canvas_timestamp(document.get('updated_at')),
            }
            documents[canvas_id] = document
            chat_data[CANVAS_DOCUMENTS_KEY] = documents
        return set_active_canvas_document(chat_data, canvas_id), document

    mutation = await Chats.mutate_chat_by_id(id, mutate, user_id=user.id, db=db, touch=False)
    if mutation is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=ERROR_MESSAGES.NOT_FOUND)
    _, document = mutation
    return {
        'canvasId': canvas_id,
        **document,
        'contentHash': canvas_content_hash(document.get('content', '')),
    }


@router.post('/{id}/canvas/{canvas_id}/promote')
async def promote_transient_canvas_document(  # noqa: C901
    request: Request,
    id: str,
    canvas_id: str,
    form_data: CanvasPromotionForm,
    user=Depends(get_verified_user),
    db: AsyncSession = Depends(get_async_session),
):
    """Create exactly one Note from a transient Canvas document on explicit request."""
    if not await Config.get('notes.enable', True):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail='Notes are disabled.')
    if getattr(user, 'role', None) != 'admin' and not await has_permission(
        user.id,
        'features.notes',
        await Config.get('user.permissions'),
    ):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail='Notes are not available for this user.')

    async def mutate(chat_data: dict, session: AsyncSession):
        documents = dict(chat_data.get(CANVAS_DOCUMENTS_KEY) or {})
        document = documents.get(canvas_id)
        if not document:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail='Canvas document not found in this chat.',
            )

        require_canvas_precondition(
            canvas_id,
            document,
            form_data.expected_updated_at,
            form_data.expected_content_hash,
        )

        existing_note_id = document.get('note_id')
        if existing_note_id:
            existing_note = await session.get(Note, existing_note_id)
            if existing_note and existing_note.user_id == user.id:
                next_title = form_data.title.strip() or document.get('title', '') or 'Neuer Entwurf'
                sync = await sync_linked_canvas_note_content(
                    existing_note_id,
                    user.id,
                    form_data.content,
                    db=session,
                    title=next_title,
                    commit=False,
                )
                documents[canvas_id] = {
                    **document,
                    'title': next_title,
                    'content': form_data.content,
                    'title_edited': True,
                    'updated_at': canvas_timestamp(document.get('updated_at')),
                }
                chat_data[CANVAS_DOCUMENTS_KEY] = documents
                return set_active_canvas_document(chat_data, canvas_id), {
                    'note_id': existing_note_id,
                    'created': False,
                    'note': sync.note,
                    'synced': sync.note is not None,
                }

        note = await Notes.insert_new_note(
            user.id,
            NoteForm(
                title=form_data.title.strip() or 'Neuer Entwurf',
                data={'content': build_canvas_note_content(form_data.content, form_data.html, form_data.json)},
                meta={'source': 'canvas'},
                access_grants=[],
            ),
            db=session,
            commit=False,
        )
        documents[canvas_id] = {
            **document,
            'title': form_data.title.strip(),
            'content': form_data.content,
            'title_edited': True,
            'note_id': note.id,
            'updated_at': canvas_timestamp(document.get('updated_at')),
        }
        chat_data[CANVAS_DOCUMENTS_KEY] = documents
        return set_active_canvas_document(chat_data, canvas_id), {
            'note_id': note.id,
            'created': True,
            'note': note,
            'synced': False,
        }

    try:
        mutation = await Chats.mutate_chat_by_id(id, mutate, user_id=user.id, db=db, touch=False)
    except CanvasConflictError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=exc.payload) from exc
    if mutation is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=ERROR_MESSAGES.NOT_FOUND)
    _, promotion = mutation

    note = promotion.get('note') or await Notes.get_note_by_id(promotion['note_id'], db=db)
    if not note or note.user_id != user.id:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail='Canvas note was linked but could not be loaded.',
        )
    if promotion['created']:
        await publish_event(
            request,
            EVENTS.NOTE_CREATED,
            actor=user,
            subject_id=note.id,
            data={'title': note.title},
        )
    elif promotion.get('synced'):
        await sio.emit('events:note', note.model_dump(), to=f'note:{note.id}')
        await publish_event(
            request,
            EVENTS.NOTE_UPDATED,
            actor=user,
            subject_id=note.id,
            data={'title': note.title},
        )
    return note
