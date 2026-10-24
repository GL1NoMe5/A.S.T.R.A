import asyncio
from collections import deque
from datetime import timedelta
import json
import logging

import numpy as np
from redis.exceptions import RedisError, ResponseError

from app.services.background import parse_time, utcnow
from app.services.simulator import simulate_reading

log = logging.getLogger(__name__)


class TelemetryBus:
    stream = "astra:telemetry"
    group = "astra-worker"
    consumer = "single-api-worker"

    def __init__(self, redis, queue_size=32):
        self.redis = redis
        self.queue = asyncio.Queue(maxsize=queue_size)

    async def initialize(self):
        if self.redis:
            try:
                await self.redis.xgroup_create(self.stream, self.group, id="0", mkstream=True)
            except ResponseError as exc:
                if "BUSYGROUP" not in str(exc):
                    raise

    async def publish(self, readings):
        if self.redis:
            await self.redis.xadd(self.stream, {"payload": json.dumps(readings)}, maxlen=256)
        else:
            await self.queue.put(readings)

    async def receive(self):
        if not self.redis:
            return None, await self.queue.get()
        # Recover this consumer's unacknowledged messages before reading new ones.
        for cursor in ("0", ">"):
            groups = await self.redis.xreadgroup(self.group, self.consumer,
                                                {self.stream: cursor}, count=1,
                                                block=1000 if cursor == ">" else None)
            if groups and groups[0][1]:
                message_id, body = groups[0][1][0]
                # Redis may retain a pending ID whose trimmed stream entry is gone.
                if not body:
                    await self.redis.xack(self.stream, self.group, message_id)
                    continue
                return message_id, json.loads(body["payload"])
        return None, None

    async def acknowledge(self, message_id):
        if self.redis:
            await self.redis.xack(self.stream, self.group, message_id)
        else:
            self.queue.task_done()


class StreamWorker:
    def __init__(self, runtime):
        self.runtime = runtime
        self.latest = {}
        self.chart = deque(maxlen=300)
        self.processed_readings = 0
        self.batches = 0
        self.last_batch_at = None
        self.last_error = None

    def summary(self):
        values = list(self.latest.values())
        mean = lambda key: sum(r[key] for r in values) / len(values) if values else None
        return {"active_sensors": len(values), "pm25": mean("pm25"), "pm10": mean("pm10"),
                "surface_temp_c": mean("surface_temp_c"), "air_temp_c": mean("air_temp_c"),
                "esi": mean("esi"), "predicted_pm25": mean("predicted_pm25"),
                "critical_hotspots": sum(r["esi"] >= 60 for r in values),
                "hotspot_definition": "Условный ESI ≥ 60"}

    def snapshot(self):
        return {"type": "snapshot", "timestamp": utcnow().isoformat(),
                "readings": list(self.latest.values()), "summary": self.summary(),
                "background": self.runtime.background.snapshot(), "history": list(self.chart),
                "mode": self.runtime.storage.mode}

    async def process(self, readings):
        r = self.runtime
        enriched = await asyncio.to_thread(r.ml.enrich, readings)
        inserted = await r.storage.save_batch(enriched)
        for reading in enriched:
            old = self.latest.get(reading["sensor_id"])
            if old is None or parse_time(reading["timestamp"]) >= parse_time(old["timestamp"]):
                self.latest[reading["sensor_id"]] = reading
        self.last_batch_at = utcnow().isoformat()
        self.last_error = None
        self.processed_readings += len(inserted)
        self.batches += 1
        summary = self.summary()
        if inserted:
            point = {"timestamp": max(x["timestamp"] for x in inserted), **summary}
            self.chart.append(point)
            r.manager.publish({"type": "telemetry", "timestamp": point["timestamp"],
                               "readings": list(self.latest.values()), "summary": summary,
                               "background": r.background.snapshot(), "mode": r.storage.mode})
        if self.batches % 30 == 0:
            await r.storage.prune(r.settings)
        if r.storage.redis:
            await r.storage.redis.set("astra:latest-summary", json.dumps(summary), ex=600)

    async def run(self):
        while True:
            try:
                message_id, readings = await self.runtime.bus.receive()
                if readings is None:
                    continue
                while True:
                    try:
                        await self.process(readings)
                        await self.runtime.bus.acknowledge(message_id)
                        break
                    except asyncio.CancelledError:
                        raise
                    except Exception as exc:
                        self.last_error = type(exc).__name__
                        log.exception("Telemetry processing failed; retrying same batch")
                        await asyncio.sleep(1)
            except asyncio.CancelledError:
                raise
            except (RedisError, OSError) as exc:
                self.last_error = type(exc).__name__
                log.warning("Telemetry broker unavailable; reconnecting")
                await asyncio.sleep(1)


async def run_simulator(runtime):
    rng = np.random.default_rng(runtime.settings.seed)
    while True:
        stamp = utcnow()
        bg = runtime.background.snapshot()
        readings = [simulate_reading(z, stamp, bg, rng) for z in runtime.zones]
        try:
            await runtime.bus.publish(readings)
        except RedisError:
            log.warning("Simulator cannot publish to Redis; next tick will retry")
        await asyncio.sleep(runtime.settings.tick_seconds)
