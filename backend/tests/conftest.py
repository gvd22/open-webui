import asyncio
from unittest.mock import AsyncMock

import pytest
from open_webui.models.chats import Chats


@pytest.fixture
def install_chat_mutator(monkeypatch):
    def install(chat, *, load=True):
        async def mutate_chat(_id, mutator, **_kwargs):
            mutation = mutator(dict(chat.chat), None)
            if asyncio.iscoroutine(mutation):
                mutation = await mutation
            chat.chat, result = mutation
            return chat, result

        if load:
            monkeypatch.setattr(Chats, 'get_chat_by_id', AsyncMock(return_value=chat))
        monkeypatch.setattr(Chats, 'mutate_chat_by_id', mutate_chat)

    return install
