import asyncio
from types import SimpleNamespace

import anyio
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.ws import WebSocketManager, router, telemetry_socket


def make_runtime():
    return SimpleNamespace(
        manager=WebSocketManager(),
        worker=SimpleNamespace(snapshot=lambda: {"type": "snapshot", "readings": []}),
    )


async def test_scope_cancellation_waits_for_both_socket_operations_to_clean_up():
    """Cancelling a connection must await async transport cleanup, not interrupt it."""
    runtime = make_runtime()

    class FakeSocket:
        app = SimpleNamespace(state=SimpleNamespace(runtime=runtime))

        def __init__(self):
            self.started = [asyncio.Event(), asyncio.Event()]
            self.cleaned = [False, False]

        async def accept(self):
            pass

        async def send_json(self, payload):
            await self.block_until_cancelled(0)

        async def receive_text(self):
            await self.block_until_cancelled(1)

        async def block_until_cancelled(self, slot):
            self.started[slot].set()
            try:
                await asyncio.Event().wait()
            finally:
                # A real socket/transport may need an async step to release resources.
                await asyncio.sleep(.005)
                self.cleaned[slot] = True

    socket = FakeSocket()
    scopes = []

    async def connection():
        with anyio.CancelScope() as scope:
            scopes.append(scope)
            await telemetry_socket(socket)

    task = asyncio.create_task(connection())
    await asyncio.wait_for(asyncio.gather(*(event.wait() for event in socket.started)), 1)
    assert len(runtime.manager.clients) == 1
    scopes[0].cancel()
    await asyncio.wait_for(task, 1)
    assert socket.cleaned == [True, True]
    assert not runtime.manager.clients


def test_repeated_websocket_reconnections_close_without_cancellation_errors():
    application = FastAPI()
    application.include_router(router)
    application.state.runtime = make_runtime()
    with TestClient(application) as client:
        for _ in range(100):
            with client.websocket_connect("/ws/telemetry") as socket:
                assert socket.receive_json() == {"type": "snapshot", "readings": []}
            assert not application.state.runtime.manager.clients
