import asyncio
from contextlib import asynccontextmanager
import logging
from pathlib import Path
from types import SimpleNamespace

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
import numpy as np

from app.api.routes import router
from app.api.ws import router as ws_router, WebSocketManager
from app.core.config import Settings
from app.core.zones import make_zones
from app.db.session import create_storage
from app.ml.engine import MLEngine
from app.services.background import BackgroundService, utcnow
from app.services.simulator import simulate_reading
from app.services.stream_worker import StreamWorker, TelemetryBus, run_simulator

log = logging.getLogger(__name__)
STATIC = Path(__file__).parent / "static"


class RevalidatedStaticFiles(StaticFiles):
    async def get_response(self, path, scope):
        response = await super().get_response(path, scope)
        # Keep ETag/304 caching, but never mix old scripts with updated HTML.
        response.headers["Cache-Control"] = "no-cache"
        return response


def create_app(settings: Settings | None = None):
    @asynccontextmanager
    async def lifespan(app: FastAPI):
        cfg = settings or Settings()
        storage = await create_storage(cfg)
        tasks = []
        try:
            zones = make_zones()
            await storage.initialize(zones)
            bg = BackgroundService(cfg)
            ml = MLEngine(cfg.data_dir, zones, cfg.seed)
            await asyncio.gather(bg.refresh(), asyncio.to_thread(ml.initialize))
            r = SimpleNamespace(settings=cfg, storage=storage, zones=zones, background=bg,
                                ml=ml, manager=WebSocketManager(), tasks=tasks)
            r.bus = TelemetryBus(storage.redis, cfg.queue_size)
            await r.bus.initialize()
            r.worker = StreamWorker(r)
            r.worker.latest = {row["sensor_id"]: row for row in await storage.latest()}
            rng = np.random.default_rng(cfg.seed)
            stamp = utcnow()
            await r.worker.process([simulate_reading(z, stamp, bg.snapshot(), rng) for z in zones])
            app.state.runtime = r
            for name, coroutine in (("telemetry-worker", r.worker.run()),
                                    ("iot-simulator", run_simulator(r)), ("open-meteo", bg.run())):
                task = asyncio.create_task(coroutine, name=name)
                def report_failure(completed):
                    if not completed.cancelled() and completed.exception():
                        log.error("Background task failed: %s", completed.get_name(),
                                  exc_info=completed.exception())
                task.add_done_callback(report_failure)
                tasks.append(task)
            yield
        finally:
            for task in tasks:
                task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)
            await storage.close()

    app = FastAPI(title="ASTRA · Экологическая аналитика Астаны", version="1.0.0", lifespan=lifespan)
    app.include_router(router)
    app.include_router(ws_router)
    app.mount("/static", RevalidatedStaticFiles(directory=STATIC), name="static")

    @app.get("/", include_in_schema=False)
    async def dashboard():
        return FileResponse(STATIC / "index.html", headers={"Cache-Control": "no-cache"})

    return app


app = create_app()
