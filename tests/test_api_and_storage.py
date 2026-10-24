import asyncio
from copy import deepcopy
from datetime import timedelta

from fastapi.testclient import TestClient
import numpy as np
import pytest
from sqlalchemy import func, select

from app.core.config import Settings
from app.db.models import MinuteAggregate, OptimizationRun, Telemetry
from app.db.session import create_storage
from app.main import create_app
from app.services.background import BackgroundService, utcnow
from app.services.simulator import simulate_reading


def test_api_websocket_validation_and_restart(tmp_path):
    settings = Settings(data_dir=tmp_path, mode="local", background_enabled=False, tick_seconds=.1)
    application = create_app(settings)
    with TestClient(application) as client:
        assert client.get("/").status_code == 200
        for asset, mime in (("report.html", "text/html"), ("report.css", "text/css"),
                            ("report.js", "javascript")):
            response = client.get(f"/static/report/{asset}")
            assert response.status_code == 200
            assert mime in response.headers["content-type"]
        health = client.get("/health").json()
        assert health["status"] == "ok" and health["mode"] == "local"
        assert health["background"]["air"] == "default"
        sensors = client.get("/api/v1/sensors").json()["sensors"]
        assert len(sensors) == 40
        assert all(s["latest"]["kind"] == "virtual_station" for s in sensors)
        sid = sensors[0]["id"]
        for target in ("esi", "pm25"):
            response = client.get(f"/api/v1/analytics/explain/{sid}?target={target}")
            assert response.status_code == 200 and response.json()["additivity_error"] < 1e-5
        assert client.get("/api/v1/analytics/explain/missing").status_code == 404
        assert client.get(f"/api/v1/analytics/explain/{sid}?target=invalid").status_code == 422
        for body in ({"budget_trees": 99}, {"species": "oak"}, {"target_district": "missing"},
                     {"annual_care_cost_kzt": -1}, {"unexpected": 1}):
            assert client.post("/api/v1/optimize/greening", json=body).status_code == 422
        result = client.post("/api/v1/optimize/greening", json={"budget_trees":100,"target_district":"yesil"})
        assert result.status_code == 200
        assert result.json()["used_trees"] == 100
        assert result.json()["background"]["air"]["status"] == "default"
        assert client.get("/api/v1/telemetry/history").json()["points"]
        assert client.get("/api/v1/telemetry/history?minutes=1440").json()["points"]
        assert client.get("/api/v1/telemetry/history?sensor_id=missing").status_code == 404
        assert client.get("/api/v1/telemetry/history?minutes=0").status_code == 422
        assert client.get("/api/v1/metrics").json()["ml"]["rows"] == 5000
        assert client.get("/api/v1/methodology").json()["version"] == "scenario-v1"
        with client.websocket_connect("/ws/telemetry") as ws:
            initial = ws.receive_json()
            assert initial["type"] == "snapshot" and len(initial["readings"]) == 40
            update = ws.receive_json()
            assert update["type"] == "telemetry" and len(update["readings"]) == 40
        # Reconnection always starts with a complete snapshot.
        with client.websocket_connect("/ws/telemetry") as ws:
            assert len(ws.receive_json()["readings"]) == 40
    assert all(t.done() for t in application.state.runtime.tasks)
    with TestClient(create_app(settings)) as client:
        assert client.get("/health").status_code == 200
        assert len(client.app.state.runtime.tasks) == 3


async def test_storage_idempotence_retention_and_aggregates(tmp_path, zones, ml):
    settings = Settings(data_dir=tmp_path, mode="local", background_enabled=False)
    storage = await create_storage(settings)
    try:
        await storage.initialize(zones)
        bg = BackgroundService(settings).snapshot()
        rng = np.random.default_rng(42)
        stamp = utcnow()
        raw = [simulate_reading(z, stamp, bg, rng) for z in zones]
        readings = ml.enrich(raw)
        assert len(await storage.save_batch(readings)) == 40
        assert await storage.save_batch(readings) == []
        async with storage.sessions() as session:
            assert await session.scalar(select(func.count()).select_from(Telemetry)) == 40
            aggregate = await session.scalar(select(MinuteAggregate))
            assert aggregate.payload["count"] == 1
        later = deepcopy(readings[:1])
        later[0]["timestamp"] = (stamp + timedelta(microseconds=1)).isoformat()
        later[0]["pm25"] += 10
        await storage.save_batch(later)
        async with storage.sessions() as session:
            aggregate = await session.get(MinuteAggregate, (later[0]["sensor_id"], stamp.replace(second=0,microsecond=0)))
            assert aggregate.payload["count"] == 2
            assert aggregate.payload["pm25"] == pytest.approx(readings[0]["pm25"] + 5)
        old = deepcopy(readings[:1])
        old[0]["timestamp"] = (stamp - timedelta(hours=2)).isoformat()
        await storage.save_batch(old)
        assert len(await storage.latest()) == 40
        await storage.prune(settings)
        async with storage.sessions() as session:
            assert await session.scalar(select(func.count()).select_from(Telemetry)) == 41
            assert await session.scalar(select(func.count()).select_from(MinuteAggregate)) == 41
    finally:
        await storage.close()


async def test_modes_without_infrastructure(tmp_path):
    auto = await create_storage(Settings(data_dir=tmp_path, background_enabled=False))
    assert auto.mode == "local"
    await auto.close()
    with pytest.raises(RuntimeError, match="DATABASE_URL"):
        await create_storage(Settings(data_dir=tmp_path, mode="docker"))


async def test_auto_falls_back_as_pair_and_docker_is_strict(tmp_path):
    values = dict(data_dir=tmp_path, database_url="postgresql+asyncpg://x:x@127.0.0.1:1/x",
                  redis_url="redis://127.0.0.1:1/0", background_enabled=False)
    auto = await create_storage(Settings(**values))
    assert auto.mode == "local" and auto.redis is None
    await auto.close()
    with pytest.raises(RuntimeError, match="недоступны"):
        await create_storage(Settings(**values, mode="docker"))
