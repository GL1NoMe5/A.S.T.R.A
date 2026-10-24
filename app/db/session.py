import asyncio
from collections import defaultdict
from datetime import timedelta
import logging

from redis.asyncio import Redis
from sqlalchemy import delete, event, select, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.config import Settings
from app.db.models import Base, MinuteAggregate, OptimizationRun, Sensor, Telemetry
from app.services.background import parse_time, utcnow

log = logging.getLogger(__name__)
METRIC_KEYS = ("pm25", "surface_temp_c", "air_temp_c", "esi", "predicted_pm25", "predicted_esi")


class Storage:
    def __init__(self, engine, redis, mode, reason):
        self.engine = engine
        self.redis = redis
        self.mode = mode
        self.reason = reason
        self.sessions = async_sessionmaker(engine, expire_on_commit=False)

    async def initialize(self, zones):
        async with self.engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        async with self.sessions() as session:
            for zone in zones:
                await session.merge(Sensor(id=zone["id"], payload=zone))
            await session.commit()

    async def save_batch(self, readings):
        """Persist once; a replay cannot inflate minute counts."""
        inserted = []
        async with self.sessions() as session:
            for reading in readings:
                timestamp = parse_time(reading["timestamp"])
                key = (reading["sensor_id"], timestamp)
                if await session.get(Telemetry, key) is not None:
                    continue
                session.add(Telemetry(sensor_id=key[0], timestamp=timestamp, payload=reading))
                minute = timestamp.replace(second=0, microsecond=0)
                aggregate = await session.get(MinuteAggregate, (key[0], minute))
                values = {k: float(reading[k]) for k in METRIC_KEYS}
                if aggregate:
                    old = aggregate.payload
                    count = old["count"] + 1
                    aggregate.payload = {"count": count, **{
                        k: (old[k] * old["count"] + values[k]) / count for k in METRIC_KEYS}}
                else:
                    session.add(MinuteAggregate(sensor_id=key[0], timestamp=minute,
                                                payload={"count": 1, **values}))
                inserted.append(reading)
            await session.commit()
        return inserted

    async def history(self, minutes=60, sensor_id=None):
        cutoff = utcnow() - timedelta(minutes=minutes)
        model = Telemetry if minutes <= 60 else MinuteAggregate
        query = select(model).where(model.timestamp >= cutoff).order_by(model.timestamp)
        if sensor_id:
            query = query.where(model.sensor_id == sensor_id)
        async with self.sessions() as session:
            records = (await session.scalars(query)).all()
        bins = defaultdict(list)
        for record in records:
            # Minute resolution bounds the HTTP response and the browser buffer.
            bins[record.timestamp.replace(second=0, microsecond=0).isoformat() +
                 ("+00:00" if record.timestamp.tzinfo is None else "")].append(record.payload)
        return [{"timestamp": stamp, **{
            key: sum(float(r[key]) * r.get("count", 1) for r in values) /
                 sum(r.get("count", 1) for r in values) for key in METRIC_KEYS}}
                for stamp, values in sorted(bins.items())]

    async def latest(self):
        # Load only one latest row per sensor; avoid scanning an unbounded result.
        from sqlalchemy import func
        sub = select(Telemetry.sensor_id, func.max(Telemetry.timestamp).label("latest")).group_by(
            Telemetry.sensor_id).subquery()
        query = select(Telemetry.payload).join(sub, (Telemetry.sensor_id == sub.c.sensor_id) &
                                                (Telemetry.timestamp == sub.c.latest))
        async with self.sessions() as session:
            return (await session.scalars(query)).all()

    async def save_optimization(self, result):
        async with self.sessions() as session:
            session.add(OptimizationRun(id=result["run_id"], timestamp=utcnow(), payload=result))
            await session.commit()

    async def prune(self, settings):
        async with self.sessions() as session:
            for model, cutoff in ((Telemetry, utcnow() - timedelta(minutes=settings.retention_minutes)),
                                  (MinuteAggregate, utcnow() - timedelta(hours=settings.aggregate_retention_hours)),
                                  (OptimizationRun, utcnow() - timedelta(days=30))):
                await session.execute(delete(model).where(model.timestamp < cutoff))
            await session.commit()

    async def close(self):
        if self.redis:
            await self.redis.aclose()
        await self.engine.dispose()


async def create_storage(settings: Settings) -> Storage:
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    reason = "Локальный режим: SQLite и очередь в памяти"
    if settings.mode != "local" and settings.database_url and settings.redis_url:
        engine = create_async_engine(settings.database_url, pool_pre_ping=True)
        redis = Redis.from_url(settings.redis_url, decode_responses=True,
                               socket_connect_timeout=3, socket_timeout=5)
        try:
            async def probe():
                async with engine.connect() as connection:
                    await connection.execute(text("SELECT 1"))
                await redis.ping()
            await asyncio.wait_for(probe(), timeout=5)
            return Storage(engine, redis, "docker", "PostgreSQL + Redis Streams")
        except Exception:
            await redis.aclose()
            await engine.dispose()
            if settings.mode == "docker":
                raise RuntimeError("PostgreSQL / Redis недоступны в явном docker-режиме") from None
            reason = "Инфраструктура недоступна при старте: выбраны SQLite и очередь"
            log.warning(reason)
    elif settings.mode == "docker":
        raise RuntimeError("Для docker-режима необходимы DATABASE_URL и REDIS_URL")
    engine = create_async_engine(settings.sqlite_url)

    @event.listens_for(engine.sync_engine, "connect")
    def configure_sqlite(connection, _):
        cursor = connection.cursor()
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA busy_timeout=5000")
        cursor.close()

    return Storage(engine, None, "local", reason)
