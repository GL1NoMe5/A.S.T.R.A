import json
from pathlib import Path
from uuid import uuid4

from fastapi.testclient import TestClient

from app.core.config import Settings
from app.main import create_app


def test_saved_plan_list_pagination_and_validation(tmp_path):
    settings = Settings(data_dir=tmp_path, mode="local", background_enabled=False, tick_seconds=2)
    with TestClient(create_app(settings)) as client:
        empty = client.get("/api/v1/optimizations").json()
        assert empty == {"items": [], "total": 0, "limit": 20, "offset": 0, "retention_days": 30}
        originals = []
        for parameters, scenario in [({"budget_trees": 100}, "current_weather"),
                                     ({"budget_trees": 10000, "thermal_scenario": "summer_day"}, "summer_day")]:
            response = client.post("/api/v1/optimize/greening", json=parameters)
            assert response.status_code == 200
            assert response.json()["request"]["thermal_scenario"] == scenario
            if parameters["budget_trees"] == 10000:
                plan = response.json()
                assert plan["used_trees"] == 10000 and plan["unused_trees"] == 0
                assert len(plan["zones"]) > 10
                assert plan["allocation"]["unused_reason"] is None
                assert plan["summary"]["pm25_reduction"] > 0
                assert plan["summary"]["cooling_c"] > 0
                assert client.get(f"/api/v1/optimizations/{plan['run_id']}").json() == plan
            originals.append(response.json())

        expected_keys = {"run_id", "created_at", "request", "used_trees", "unused_trees",
                         "horizon_years", "costs", "summary"}
        for offset, original in enumerate(reversed(originals)):
            response = client.get(f"/api/v1/optimizations?limit=1&offset={offset}")
            assert response.status_code == 200
            page = response.json()
            assert page["total"] == 2 and page["retention_days"] == 30
            assert page["limit"] == 1 and page["offset"] == offset
            item = {key: original[key] for key in expected_keys}
            item["methodology_version"] = original["methodology"]["version"]
            assert page["items"] == [item]
        assert client.post("/api/v1/optimize/greening", json={"thermal_scenario": "invalid"}).status_code == 422
        assert client.get("/api/v1/optimizations?offset=2").json()["items"] == []
        for query in ("limit=0", "limit=101", "offset=-1", "offset=bad"):
            assert client.get(f"/api/v1/optimizations?{query}").status_code == 422
        assert client.get("/api/v1/optimizations/not-a-uuid").status_code == 422
        assert client.get(f"/api/v1/optimizations/{uuid4()}").status_code == 404


def test_original_plan_survives_restart_without_recalculation(tmp_path, monkeypatch):
    settings = Settings(data_dir=tmp_path, mode="local", background_enabled=False, tick_seconds=2)
    with TestClient(create_app(settings)) as client:
        response = client.post("/api/v1/optimize/greening", json={
            "budget_trees": 100, "target_district": "yesil", "species": "pine",
            "horizon_years": 7, "sapling_cost_kzt": 21345,
        })
        assert response.status_code == 200
        original = response.json()
        endpoint = f"/api/v1/optimizations/{original['run_id']}"

        def reject_recalculation(*args, **kwargs):
            raise AssertionError("Reading a saved plan must not recalculate it")

        monkeypatch.setattr("app.api.routes.optimize", reject_recalculation)
        assert client.get(endpoint).json() == original

    with TestClient(create_app(settings)) as client:
        response = client.get(endpoint)
        assert response.status_code == 200
        assert response.json() == original
        assert client.get("/api/v1/optimizations").json()["total"] == 1

        fixture = Path(__file__).resolve().parents[1] / "examples" / "optimization.sample.json"
        legacy = json.loads(fixture.read_text(encoding="utf-8"))
        client.portal.call(client.app.state.runtime.storage.save_optimization, legacy)
        archived = next(item for item in client.get("/api/v1/optimizations").json()["items"]
                        if item["run_id"] == legacy["run_id"])
        assert archived["methodology_version"] == "scenario-v1"
        assert "thermal_scenario" not in archived["request"]
        assert client.get(f"/api/v1/optimizations/{legacy['run_id']}").json() == legacy
