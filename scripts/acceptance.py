"""Fresh offline application, real short stream test, restart and persistence checks."""
import argparse
import asyncio
import json
from pathlib import Path
import socket
import sqlite3
import subprocess
import sys
import time
import uuid

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import httpx

from scripts.run_local import ASSETS, environment_report, launch_spec
from scripts.smoke_test import run as smoke_run


async def wait_ready(process, base, timeout=30):
    deadline = time.monotonic() + timeout
    async with httpx.AsyncClient(timeout=2, trust_env=False) as client:
        while time.monotonic() < deadline:
            if process.poll() is not None:
                raise RuntimeError(f"Тестовый сервер завершился: код {process.returncode}; см. server.log")
            try:
                response = await client.get(base + "/health")
                if response.status_code == 200:
                    return response.json()
            except httpx.RequestError:
                pass
            await asyncio.sleep(.2)
    raise TimeoutError("Тестовый сервер не запустился за 30 секунд; см. server.log")


def stop_process(process):
    """Only stop the child created by this acceptance run, never an existing service."""
    if process is not None and process.poll() is None:
        process.terminate()
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=5)


def stored_counts(path):
    with sqlite3.connect(path.as_uri() + "?mode=ro", uri=True, timeout=5) as connection:
        return {table: connection.execute(f"SELECT count(*) FROM {table}").fetchone()[0]
                for table in ("sensors", "telemetry", "optimization_runs")}


async def run(seconds=30):
    diagnostics = environment_report()
    if diagnostics["status"] != "ok":
        raise RuntimeError("Окружение не готово: выполните scripts/run_local.py --check")
    # Artifacts remain for inspection. Never touch the application's working data directory.
    run_dir = ROOT / "artifacts" / "acceptance" / uuid.uuid4().hex[:12]
    run_dir.mkdir(parents=True)
    data_dir = run_dir / "data"
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as reservation:
        reservation.bind(("127.0.0.1", 0))
        port = reservation.getsockname()[1]
    base = f"http://127.0.0.1:{port}"
    command, env = launch_spec(port, offline=True, data_dir=data_dir)
    # Explicit values make this acceptance independent of the user's .env/settings.
    env.update(ASTRA_TICK_SECONDS="2", ASTRA_SEED="42", ASTRA_RETENTION_MINUTES="60",
               ASTRA_AGGREGATE_RETENTION_HOURS="24", ASTRA_QUEUE_SIZE="32")
    report = {"status": "failed", "url": base, "data_dir": str(data_dir), "offline": True}
    process = None
    started = time.monotonic()
    with (run_dir / "server.log").open("w", encoding="utf-8") as log:
        def start():
            return subprocess.Popen(command, cwd=ROOT, env=env, stdout=log, stderr=subprocess.STDOUT,
                                    creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        try:
            process = start()
            health = await wait_ready(process, base)
            report["cold_start_seconds"] = round(time.monotonic() - started, 2)
            assert health["mode"] == "local"
            assert health["background"] == {"air": "default", "weather": "default"}
            async with httpx.AsyncClient(base_url=base, timeout=15, trust_env=False) as client:
                for asset in ASSETS:
                    url = "/" if asset == "index.html" else "/static/" + asset
                    response = await client.get(url)
                    response.raise_for_status()
                    assert response.content, url
                background = (await client.get("/api/v1/background")).json()
                assert background["air"]["values"]["european_aqi"] is None
                for target in ("pm25", "esi"):
                    response = await client.get(f"/api/v1/analytics/explain/AST-001?target={target}")
                    response.raise_for_status()
                    assert response.json()["additivity_error"] < 1e-5
            report["stream"] = await smoke_run(base, seconds, emit=False)
            model = data_dir / "models.joblib"
            model_mtime = model.stat().st_mtime_ns
            before = stored_counts(data_dir / "astra.db")
            assert before["sensors"] == 40 and before["optimization_runs"] >= 1
            stop_process(process)
            process = start()
            await wait_ready(process, base)
            after = stored_counts(data_dir / "astra.db")
            assert after["telemetry"] >= before["telemetry"]
            assert after["optimization_runs"] == before["optimization_runs"]
            assert model.stat().st_mtime_ns == model_mtime, "Модель должна читаться из кэша при перезапуске"
            report.update(status="passed", restart="passed", model_reused=True,
                          stored_before_restart=before, stored_after_restart=after)
        except BaseException as exc:
            report["error"] = f"{type(exc).__name__}: {exc}"
            raise
        finally:
            stop_process(process)
            report["test_process_stopped"] = process is None or process.poll() is not None
            report["total_seconds"] = round(time.monotonic() - started, 2)
            report_path = run_dir / "result.json"
            report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
            print(json.dumps({**report, "report_path": str(report_path)}, ensure_ascii=False, indent=2))
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Автономная приёмка ASTRA без изменения рабочей базы")
    parser.add_argument("--seconds", type=int, choices=range(30, 61), default=30)
    options = parser.parse_args()
    asyncio.run(run(options.seconds))
