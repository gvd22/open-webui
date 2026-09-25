"""Publish note updates shared by Notes and linked Canvas tools."""

from fastapi import Request
from open_webui.events import EVENTS, publish_event
from open_webui.socket.main import sio


async def emit_note_updated(request: Request, user: dict, note) -> None:
    await sio.emit('events:note', note.model_dump(), to=f'note:{note.id}')
    await publish_event(
        request,
        EVENTS.NOTE_UPDATED,
        actor=user,
        subject_id=note.id,
        data={'title': note.title},
    )
