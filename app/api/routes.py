import asyncio
from copy import deepcopy
from typing import Literal

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import JSONResponse

from app.core.zones import DISTRICTS
from app.ml.engine import FORECAST_POLICY
from app.ml.optimizer import METHODOLOGY, SPECIES, optimize
from app.schemas.telemetry import OptimizeRequest
from app.services.background import parse_time, utcnow

router = APIRouter()


@router.get("/health")
async def health(request: Request):
    r = request.app.state.runtime
    age = (utcnow() - parse_time(r.worker.last_batch_at)).total_seconds() if r.worker.last_batch_at else 999
    healthy = not r.worker.last_error and age < max(15, r.settings.tick_seconds * 5)
    healthy = healthy and all(not t.done() for t in r.tasks)
    return JSONResponse({"status": "ok" if healthy else "degraded", "mode": r.storage.mode,
                         "mode_reason": r.storage.reason, "last_batch_at": r.worker.last_batch_at,
                         "worker_error": r.worker.last_error, "queue_size": r.bus.queue.qsize(),
                         "background": {k: r.background.snapshot()[k]["status"] for k in ("air", "weather")}},
                        status_code=200 if healthy else 503)


@router.get("/api/v1/background")
async def background(request: Request):
    return request.app.state.runtime.background.snapshot()


@router.get("/api/v1/sensors")
async def sensors(request: Request):
    r = request.app.state.runtime
    return {"sensors": [{**z, "latest": r.worker.latest.get(z["id"])} for z in r.zones],
            "districts": DISTRICTS, "kind": "virtual_pilot_zones"}


@router.get("/api/v1/telemetry/history")
async def history(request: Request, minutes: int = Query(60, ge=1, le=1440), sensor_id: str | None = None):
    r = request.app.state.runtime
    if sensor_id and sensor_id not in r.ml.zones:
        raise HTTPException(404, "Виртуальная станция не найдена")
    return {"points": await r.storage.history(minutes, sensor_id), "resolution": "1 minute",
            "kind": "virtual_station_aggregate"}


@router.get("/api/v1/analytics/explain/{sensor_id}")
async def explain(request: Request, sensor_id: str, target: Literal["pm25", "esi"] = "pm25",
                  method: Literal["primary", "ml"] = "primary"):
    r = request.app.state.runtime
    reading = r.worker.latest.get(sensor_id)
    if reading is None:
        raise HTTPException(404, "Виртуальная станция не найдена")
    return await asyncio.to_thread(r.ml.explain, deepcopy(reading), target, method)


@router.post("/api/v1/optimize/greening")
async def greening(request: Request, parameters: OptimizeRequest):
    r = request.app.state.runtime
    result = await asyncio.to_thread(optimize, parameters, r.zones,
                                     deepcopy(r.worker.latest), r.background.snapshot())
    await r.storage.save_optimization(result)
    return result


@router.get("/api/v1/methodology")
async def methodology():
    return {**METHODOLOGY, "species": SPECIES, "forecast_policy": FORECAST_POLICY,
            "esi_formula": "100 × (0.5×clip(PM2.5/100) + 0.2×clip(NO2/100) + 0.3×clip((Tsurface−25)/20))",
            "clip": "Ограничение от 0 до 1", "esi_kind": "scenario_index_not_official_aqi"}


@router.get("/api/v1/metrics")
async def metrics(request: Request):
    r = request.app.state.runtime
    return {"ml": r.ml.metrics, "stream": {"processed_readings": r.worker.processed_readings,
            "batches": r.worker.batches, "last_batch_at": r.worker.last_batch_at,
            "connected_clients": len(r.manager.clients)}, "summary": r.worker.summary(),
            "mode": r.storage.mode}
