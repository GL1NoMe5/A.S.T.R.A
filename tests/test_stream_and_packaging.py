import asyncio
from pathlib import Path

import pytest
from redis.exceptions import ResponseError
import yaml

from app.api.ws import WebSocketManager
from app.services.stream_worker import TelemetryBus


async def test_queue_backpressure_and_delivery():
    bus = TelemetryBus(None, queue_size=1)
    await bus.publish([{"sequence":1}])
    second = asyncio.create_task(bus.publish([{"sequence":2}]))
    await asyncio.sleep(.01)
    assert not second.done()
    message_id, batch = await bus.receive()
    assert message_id is None and batch[0]["sequence"] == 1
    await bus.acknowledge(message_id)
    await asyncio.wait_for(second, 1)
    _, batch = await bus.receive()
    assert batch[0]["sequence"] == 2
    await bus.acknowledge(None)
    await asyncio.wait_for(bus.queue.join(), 1)


def test_slow_websocket_does_not_block_other_clients():
    manager = WebSocketManager()
    slow, fast = asyncio.Queue(maxsize=1), asyncio.Queue(maxsize=4)
    manager.clients.update([slow,fast])
    manager.publish({"sequence":1})
    manager.publish({"sequence":2})
    assert slow.qsize() == 1 and slow.get_nowait()["sequence"] == 2
    assert fast.qsize() == 2


class FakeRedis:
    def __init__(self):
        self.acknowledged=[]
        self.reads=[]
        self.published=[]

    async def xgroup_create(self,*args,**kwargs):
        raise ResponseError("BUSYGROUP Consumer Group name already exists")

    async def xadd(self,*args,**kwargs):
        self.published.append((args,kwargs))

    async def xreadgroup(self,group,consumer,streams,**kwargs):
        self.reads.append(streams)
        cursor=next(iter(streams.values()))
        if cursor=="0":
            return [["astra:telemetry",[("1-0",{"payload":'[ {"sensor_id":"AST-001"} ]'})]]]
        return []

    async def xack(self,stream,group,message_id):
        self.acknowledged.append(message_id)


async def test_redis_contract_recovers_pending_before_acknowledgement():
    redis=FakeRedis()
    bus=TelemetryBus(redis)
    await bus.initialize()
    await bus.publish([{"sensor_id":"AST-001"}])
    message_id,batch=await bus.receive()
    assert batch[0]["sensor_id"]=="AST-001" and message_id=="1-0"
    assert not redis.acknowledged
    await bus.acknowledge(message_id)
    assert redis.acknowledged==["1-0"]
    assert next(iter(redis.reads[0].values()))=="0"


def test_compose_contract_and_local_assets():
    root=Path(__file__).resolve().parents[1]
    compose=yaml.safe_load((root/"docker-compose.yml").read_text(encoding="utf-8"))
    assert set(compose["services"])=={"astra","postgres","redis"}
    assert compose["services"]["astra"]["environment"]["ASTRA_MODE"]=="docker"
    assert compose["services"]["astra"]["ports"]==["127.0.0.1:8000:8000"]
    for name in ("leaflet.js","leaflet.css","leaflet-heat.js","plotly.min.js","tailwind.css","plotly-locale-ru.js"):
        assert (root/"app/static/vendor"/name).stat().st_size>100
