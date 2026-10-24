"""A real 30–60 second local acceptance run; no half-hour sleep."""
import argparse
import asyncio
import json
import time

import httpx
from websockets.asyncio.client import connect


def check_forecasts(readings):
    assert len(readings) == 40
    for reading in readings:
        assert reading["pm25"] >= 0 and 0 <= reading["esi"] <= 100
        assert reading["predicted_pm25"] == round(max(0, reading["pm25"]), 3)
        assert reading["predicted_pm25_ml"] >= 0 and 0 <= reading["predicted_esi"] <= 100
        assert reading["prediction_kind"] == "mixed_forecast"
        assert reading["prediction_methods"] == {
            "pm25": "persistence", "pm25_ml": "lightgbm", "esi": "lightgbm"}


async def run(base, seconds, emit=True, optimization_path=None):
    started=time.monotonic()
    messages=0
    failures=[]
    async with httpx.AsyncClient(base_url=base,timeout=30,trust_env=False) as client:
        health=await client.get("/health")
        health.raise_for_status()
        initial=(await client.get("/api/v1/metrics")).json()["stream"]["processed_readings"]
        async with connect(base.replace("http://","ws://").replace("https://","wss://")+"/ws/telemetry") as ws:
            first=json.loads(await asyncio.wait_for(ws.recv(),10))
            assert first["type"]=="snapshot" and len(first["readings"])==40
            check_forecasts(first["readings"])
            while time.monotonic()-started<seconds:
                update=json.loads(await asyncio.wait_for(ws.recv(),10))
                assert update["type"] == "telemetry"
                check_forecasts(update["readings"])
                messages+=1
                if messages%5==0:
                    r=await client.get("/health")
                    if r.status_code!=200:
                        failures.append(r.json())
        metrics=(await client.get("/api/v1/metrics")).json()
        assert metrics["stream"]["processed_readings"]>initial
        assert not failures, failures
        result=await client.post("/api/v1/optimize/greening",json={"budget_trees":1000})
        result.raise_for_status()
        optimization = result.json()
        assert optimization["used_trees"] + optimization["unused_trees"] == 1000
        assert sum(zone["trees"] for zone in optimization["zones"]) == optimization["used_trees"]
        if optimization_path is not None:
            optimization_path.write_text(json.dumps(optimization, ensure_ascii=False, indent=2), encoding="utf-8")
        report={"elapsed_seconds":round(time.monotonic()-started,2),"websocket_updates":messages,
                "new_readings":metrics["stream"]["processed_readings"]-initial,
                "mode":metrics["mode"],"health_failures":failures,
                "optimization_zones":len(optimization["zones"]),
                "optimization_run_id":optimization["run_id"], "forecast_policy":"passed", "status":"passed"}
        if emit:
            print(json.dumps(report,ensure_ascii=False,indent=2))
        return report


if __name__=="__main__":
    parser=argparse.ArgumentParser()
    parser.add_argument("--url",default="http://127.0.0.1:8010")
    parser.add_argument("--seconds",type=int,choices=range(30,61),default=60)
    args=parser.parse_args()
    asyncio.run(run(args.url.rstrip("/"),args.seconds))
