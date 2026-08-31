from typing import Any, Literal

from fastapi import HTTPException, status
from open_webui.constants import ERROR_MESSAGES
from open_webui.models.chats import Chats
from open_webui.socket.main import SESSION_POOL, get_event_emitter
from open_webui.utils.json_codec import JSONCodec
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession


class ResolveToolCallForm(BaseModel):
    call_id: str
    action: Literal['approve', 'reject', 'answer']
    answers: Any | None = None
    timed_out: bool = False
    session_id: str | None = None


def _validate_resume_session(session_id: str | None, user_id: str) -> None:
    """Reject a browser socket that is not currently owned by the caller."""
    if session_id and SESSION_POOL.get(session_id, {}).get('id') != user_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail='Browser session is not available for this user.',
        )


async def resolve_tool_call_output(
    chat_id: str,
    message_id: str,
    form_data: ResolveToolCallForm,
    user,
    db: AsyncSession | None = None,
) -> dict:
    chat = await Chats.get_chat_by_id(chat_id, db=db)
    if not chat or (chat.user_id != user.id and user.role != 'admin'):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=ERROR_MESSAGES.ACCESS_PROHIBITED,
        )

    _validate_resume_session(form_data.session_id, user.id)

    def resolve(message):
        output = message.get('output') or []
        if not isinstance(output, list):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='Message has no resolvable output.')

        function_call = next(
            (
                item
                for item in output
                if item.get('type') == 'function_call' and (item.get('call_id') or item.get('id')) == form_data.call_id
            ),
            None,
        )
        if not function_call:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Tool call not found.')
        function_call.setdefault('call_id', form_data.call_id)
        tool_name = function_call.get('name')

        if any(
            item.get('type') == 'function_call_output' and item.get('call_id') == form_data.call_id for item in output
        ) or function_call.get('status') not in {'pending', 'requires_approval'}:
            detail = (
                'Tool call is already running; it was not retried.'
                if function_call.get('execution_started') or function_call.get('status') == 'in_progress'
                else 'Tool call has already been resolved.'
            )
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=detail)

        if form_data.action == 'approve':
            if tool_name == 'ask_user':
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='ask_user requires an answer or deny.')
            function_call['status'] = 'queued'
            function_call['approved'] = True
        elif form_data.action == 'reject':
            function_call['status'] = 'rejected'
            output.append(
                {
                    'type': 'function_call_output',
                    'id': f'fco_{form_data.call_id}',
                    'call_id': form_data.call_id,
                    'output': [{'type': 'input_text', 'text': 'Error: tool call rejected by user.'}],
                    'status': 'rejected',
                }
            )
        else:
            if tool_name != 'ask_user':
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='Tool call does not accept answers.')
            if form_data.answers is None and not form_data.timed_out:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='Answers are required for ask_user.')
            function_call['status'] = 'completed'
            answer_payload = (
                {'status': 'cancelled', 'answers': {}, 'timed_out': True}
                if form_data.timed_out
                else {'status': 'answered', 'answers': form_data.answers or {}}
            )
            output.append(
                {
                    'type': 'function_call_output',
                    'id': f'fco_{form_data.call_id}',
                    'call_id': form_data.call_id,
                    'output': [{'type': 'input_text', 'text': JSONCodec.dumps(answer_payload)}],
                    'status': 'completed',
                }
            )

        if form_data.session_id:
            message['meta'] = {
                **(message.get('meta') if isinstance(message.get('meta'), dict) else {}),
                'session_id': form_data.session_id,
            }
        message['done'] = False
        message['output'] = output
        return message

    try:
        resolved = await Chats.mutate_message_by_id(chat_id, message_id, resolve, user_id=chat.user_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    if resolved is None:
        raise HTTPException(status_code=404, detail=ERROR_MESSAGES.NOT_FOUND)
    chat, message = resolved
    output = message['output']

    event_emitter = await get_event_emitter(
        {
            'user_id': chat.user_id,
            'chat_id': chat_id,
            'message_id': message_id,
        },
        update_db=False,
    )
    if event_emitter:
        await event_emitter({'type': 'chat:completion', 'data': {'output': output}})

    result_call_ids = {
        item.get('call_id') for item in output if item.get('type') == 'function_call_output' and item.get('call_id')
    }
    paused = any(
        item.get('type') == 'function_call'
        and item.get('call_id')
        and item.get('status') in {'pending', 'queued', 'requires_approval'}
        and item.get('call_id') not in result_call_ids
        for item in output
    )
    return {'chat': chat, 'message': message, 'output': output, 'paused': paused}


async def claim_approved_tool_calls(chat_id: str, message_id: str, user_id: str):
    def claim(message):
        output = message.get('output') or []
        results = {item.get('call_id') for item in output if item.get('type') == 'function_call_output'}
        if any(item.get('execution_started') and item.get('call_id') not in results for item in output):
            return output, [], True
        calls = [
            item for item in output
            if item.get('type') == 'function_call' and item.get('approved') is True
            and item.get('status') == 'queued' and item.get('call_id') not in results
        ]
        for item in calls:
            item['status'] = 'in_progress'
            item['execution_started'] = True
        return output, calls, False

    claimed = await Chats.mutate_message_by_id(chat_id, message_id, claim, user_id=user_id)
    return claimed[1] if claimed else ([], [], True)


async def build_tool_approval_resume_payload(chat_id: str, message_id: str, chat=None) -> dict:
    chat = chat or await Chats.get_chat_by_id(chat_id)
    if not chat:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=ERROR_MESSAGES.NOT_FOUND)

    assistant_message = await Chats.get_message_by_id_and_message_id(chat_id, message_id)
    if not assistant_message:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=ERROR_MESSAGES.NOT_FOUND)

    user_message_id = assistant_message.get('parentId')
    user_message = await Chats.get_message_by_id_and_message_id(chat_id, user_message_id) if user_message_id else None
    if not user_message:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail='Tool call parent message is missing.')

    chat_data = chat.chat or {}
    message_meta = assistant_message.get('meta') if isinstance(assistant_message.get('meta'), dict) else {}
    chat_params = chat_data.get('params') if isinstance(chat_data.get('params'), dict) else {}
    params = {
        **chat_params,
        **(message_meta.get('params') if isinstance(message_meta.get('params'), dict) else {}),
    }
    current_approval_mode = chat_params.get('tool_approval_mode')
    if current_approval_mode in {'ask', 'full'}:
        params['tool_approval_mode'] = current_approval_mode
    if 'tool_approval_mode' not in params:
        params['tool_approval_mode'] = 'ask'

    model_id = assistant_message.get('model') or next(iter(chat_data.get('models') or []), None)
    if not model_id:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail='Tool call message model is missing.')

    messages = []
    if params.get('system'):
        messages.append({'role': 'system', 'content': params.get('system')})

    return {
        'stream': params.get('stream_response', True),
        'model': model_id,
        'messages': messages,
        'params': params,
        # An approval snapshot may intentionally contain no files. Only use
        # mutable chat-level files for legacy messages without a snapshot key.
        'files': message_meta.get('files') if 'files' in message_meta else chat_data.get('files') or None,
        'filter_ids': message_meta.get('filter_ids') or None,
        'tool_ids': message_meta.get('tool_ids') or None,
        'skill_ids': message_meta.get('skill_ids') or None,
        'terminal_id': message_meta.get('terminal_id') or None,
        'workspace_focus': message_meta.get('workspace_focus'),
        'workspace_file': message_meta.get('workspace_file'),
        'tool_servers': message_meta.get('tool_servers') or None,
        'features': message_meta.get('features') or {},
        'variables': message_meta.get('variables') or {},
        'chat_variables': chat.variables,
        # Keep the original browser or automation target when the resolver did
        # not provide an explicit live socket. Never retarget another browser tab.
        'session_id': message_meta.get('session_id'),
        'chat_id': chat_id,
        'id': message_id,
        'parent_id': user_message.get('parentId'),
        'user_message': user_message,
        'assistant_message_id': message_id,
    }
