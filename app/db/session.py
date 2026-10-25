import asyncio
from collections import defaultdict
from contextlib import asynccontextmanager
from datetime import timedelta
import logging

from redis.asyncio import Redis
from sqlalchemy import delete, event, func, select, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.config import Settings
from app.db.models import Base, MinuteAggregate, OptimizationRun, Sensor, Telemetry
from app.db.cloud import cloud_database_options
from app.services.background import parse_time, utcnow

log = logging.getLogger(__name__)
METRIC_KEYS = ("pm25", "surface_temp_c", "air_temp_c", "esi", "predicted_pm25", "predicted_esi")
OPTIMIZATION_RETENTION_DAYS = 30
OPTIMIZATION_SUMMARY_KEYS = ("run_id", "created_at", "request", "used_trees", "unused_trees",
                             "horizon_years", "costs", "summary")


class Storage:
    def __init__(self, engine, redis, mode, reason):
        self.engine = engine
        self.redis = redis
        self.mode = mode
        self.reason = reason
        self.sessions = async_sessionmaker(engine, expire_on_commit=False)
        self.network_version = None

    @asynccontextmanager
    async def write_session(self):
        async with self.sessions() as session:
            if self.engine.dialect.name == "sqlite":
                # Reserve the single writer before reading deduplication/aggregate
                # state. busy_timeout can then wait without upgrading a stale read.
                await session.execute(text("BEGIN IMMEDIATE"))
            yield session

    async def initialize(self, zones):
        self.network_version = zones[0].get("network_version") if zones else None
        async with self.engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        async with self.write_session() as session:
            for zone in zones:
                await session.merge(Sensor(id=zone["id"], payload=zone))
            await session.commit()

    async def save_batch(self, readings):
        """Persist once; a replay cannot inflate minute counts."""
        inserted = []
        async with self.write_session() as session:
            for reading in readings:
                timestamp = parse_time(reading["timestamp"])
                key = (reading["sensor_id"], timestamp)
                if await session.get(Telemetry, key) is not None:
                    continue
                session.add(Telemetry(sensor_id=key[0], timestamp=timestamp, payload=reading))
                minute = timestamp.replace(second=0, microsecond=0)
                aggregate = await session.get(MinuteAggregate, (key[0], minute))
                values = {k: float(reading[k]) for k in METRIC_KEYS}
                version = reading.get("network_version")
                if aggregate and aggregate.payload.get("network_version") == version:
                    old = aggregate.payload
                    count = old["count"] + 1
                    aggregate.payload = {"count": count, "network_version": version, **{
                        k: (old[k] * old["count"] + values[k]) / count for k in METRIC_KEYS}}
                elif aggregate:
                    # A site relocation starts a new series, including the
                    # partial minute in which the layout changed.
                    aggregate.payload = {"count": 1, "network_version": version, **values}
                else:
                    session.add(MinuteAggregate(sensor_id=key[0], timestamp=minute,
                                                payload={"count": 1, "network_version": version, **values}))
                inserted.append(reading)
            await session.commit()
        return inserted

    async def history(self, minutes=60, sensor_id=None):
        cutoff = utcnow() - timedelta(minutes=minutes)
        model = Telemetry if minutes <= 60 else MinuteAggregate
        query = select(model).where(model.timestamp >= cutoff).order_by(model.timestamp)
        if self.network_version:
            query = query.where(model.payload["network_version"].as_string() == self.network_version)
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
        latest_query = select(Telemetry.sensor_id, func.max(Telemetry.timestamp).label("latest"))
        if self.network_version:
            latest_query = latest_query.where(Telemetry.payload["network_version"].as_string() == self.network_version)
        sub = latest_query.group_by(Telemetry.sensor_id).subquery()
        query = select(Telemetry.payload).join(sub, (Telemetry.sensor_id == sub.c.sensor_id) &
                                                (Telemetry.timestamp == sub.c.latest))
        async with self.sessions() as session:
            return (await session.scalars(query)).all()

    async def save_optimization(self, result):
        async with self.write_session() as session:
            session.add(OptimizationRun(id=result["run_id"], timestamp=utcnow(), payload=result))
            await session.commit()

    async def list_optimizations(self, limit=20, offset=0):
        """Return saved summaries, newest first, without recomputing a scenario."""
        async with self.sessions() as session:
            total = await session.scalar(select(func.count()).select_from(OptimizationRun))
            records = (await session.scalars(
                select(OptimizationRun).order_by(OptimizationRun.timestamp.desc(), OptimizationRun.id.desc())
                .limit(limit).offset(offset))).all()
            items = [{key: record.payload[key] for key in OPTIMIZATION_SUMMARY_KEYS} for record in records]
        return items, int(total or 0)

    async def get_optimization(self, run_id):
        """Return the original calculation snapshot, including its original background."""
        async with self.sessions() as session:
            record = await session.get(OptimizationRun, run_id)
            return record.payload if record is not None else None

    async def prune(self, settings):
        async with self.write_session() as session:
            for model, cutoff in ((Telemetry, utcnow() - timedelta(minutes=settings.retention_minutes)),
                                  (MinuteAggregate, utcnow() - timedelta(hours=settings.aggregate_retention_hours)),
                                  (OptimizationRun, utcnow() - timedelta(days=OPTIMIZATION_RETENTION_DAYS))):
                await session.execute(delete(model).where(model.timestamp < cutoff))
            await session.commit()

    async def close(self):
        if self.redis:
            await self.redis.aclose()
        await self.engine.dispose()


async def create_storage(settings: Settings) -> Storage:
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    if settings.mode == "cloud":
        if not settings.database_url:
            raise RuntimeError("Cloud mode requires ASTRA_DATABASE_URL")
        url, connect_args = cloud_database_options(settings.database_url)
        engine = create_async_engine(url, pool_pre_ping=True, pool_size=3,
                                     max_overflow=2, connect_args=connect_args)
        try:
            async with asyncio.timeout(40):
                async with engine.connect() as connection:
                    await connection.execute(text("SELECT 1"))
        except Exception:
            await engine.dispose()
            # Never silently switch to ephemeral SQLite or log a connection URL.
            raise RuntimeError("Cloud PostgreSQL unavailable; check connection settings") from None
        return Storage(engine, None, "cloud", "PostgreSQL + очередь в памяти")
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
        cursor.execute("PRAGMA busy_timeout=5000")
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.close()

    return Storage(engine, None, "local", reason)
