import asyncio

import anyio
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

router = APIRouter()


class WebSocketManager:
    def __init__(self):
        self.clients: set[asyncio.Queue] = set()

    def publish(self, payload):
        for queue in tuple(self.clients):
            if queue.full():
                queue.get_nowait()
            queue.put_nowait(payload)


@router.websocket("/ws/telemetry")
async def telemetry_socket(ws: WebSocket):
    await ws.accept()
    runtime = ws.app.state.runtime
    queue = asyncio.Queue(maxsize=8)
    runtime.manager.clients.add(queue)

    async def send():
        await ws.send_json(runtime.worker.snapshot())
        while True:
            await ws.send_json(await queue.get())

    async def receive():
        while True:
            await ws.receive_text()

    tasks = [asyncio.create_task(send()), asyncio.create_task(receive())]
    try:
        done, _ = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
        for task in done:
            task.result()
    except (WebSocketDisconnect, RuntimeError):
        pass
    finally:
        runtime.manager.clients.discard(queue)
        for task in tasks:
            task.cancel()
        # Finish child cleanup even when the server's surrounding cancel scope is cancelled.
        with anyio.CancelScope(shield=True):
            await asyncio.gather(*tasks, return_exceptions=True)
