from datetime import UTC, datetime

import numpy as np
import pytest

from app.ml.engine import FEATURES, MLEngine, training_data
from app.ml.optimizer import SPECIES, ecological_effect, optimize
from app.schemas.telemetry import OptimizeRequest
from app.services.background import BackgroundService
from app.core.config import Settings
from app.services.simulator import simulate_reading, stress_index


def readings_for(zones, ml, tmp_path):
    bg = BackgroundService(Settings(data_dir=tmp_path, background_enabled=False)).snapshot()
    rng = np.random.default_rng(42)
    readings = [simulate_reading(z, datetime(2026, 7, 1, 8, tzinfo=UTC), bg, rng) for z in zones]
    return {r["sensor_id"]: r for r in ml.enrich(readings)}, bg


def test_training_reproducibility_and_time_gap(zones, ml):
    x, y, _, steps = training_data(zones)
    x2, y2, _, _ = training_data(zones)
    assert x.shape == (5000, len(FEATURES))
    np.testing.assert_equal(x.values, x2.values)
    np.testing.assert_equal(y, y2)
    assert ml.metrics["train_last_target_step"] < ml.metrics["test_first_feature_step"]
    assert steps.max() == 124
    assert ml.metrics["train_rows"] + ml.metrics["test_rows"] == 4960
    for target in ml.metrics["targets"].values():
        assert np.isfinite(target["mae"]) and target["mae"] >= 0
        assert target["persistence_mae"] >= 0


def test_model_artifact_reused(ml, zones):
    original_mtime = ml.path.stat().st_mtime_ns
    reloaded = MLEngine(ml.path.parent, zones)
    reloaded.initialize()
    assert reloaded.metrics == ml.metrics
    assert ml.path.stat().st_mtime_ns == original_mtime


@pytest.mark.parametrize("target", ["pm25", "esi"])
def test_shap_exact_additivity(ml, zones, tmp_path, target):
    readings, _ = readings_for(zones, ml, tmp_path)
    explanation = ml.explain(readings[zones[0]["id"]], target)
    reconstructed = explanation["base_value"] + sum(f["contribution"] for f in explanation["features"])
    assert reconstructed == pytest.approx(explanation["prediction_raw"], abs=1e-5)
    assert len(explanation["features"]) == len(FEATURES)
    assert explanation["additivity_error"] < 1e-5


def test_stress_index_bounds():
    assert stress_index(-10, -10, -10) == 0
    assert stress_index(500, 500, 100) == 100
    assert stress_index(20, 25, 8) == 15


@pytest.mark.parametrize("species", list(SPECIES))
@pytest.mark.parametrize("budget,district", [(100, "all"), (1000, "yesil"), (10000, "all")])
def test_optimizer_budget_capacity_and_accounting(ml, zones, tmp_path, species, budget, district):
    readings, bg = readings_for(zones, ml, tmp_path)
    request = OptimizeRequest(budget_trees=budget, species=species, target_district=district)
    result = optimize(request, zones, readings, bg)
    assert result["used_trees"] + result["unused_trees"] == budget
    assert sum(z["trees"] for z in result["zones"]) == result["used_trees"]
    assert len(result["zones"]) <= (8 if district != "all" else 10)
    assert len({z["id"] for z in result["zones"]}) == len(result["zones"])
    for zone in result["zones"]:
        assert 0 < zone["trees"] <= zone["planting_capacity"]
        assert zone["pm25_after"] >= 0
        assert zone["pm25_after"] <= zone["pm25_before"]
        assert zone["surface_temp_after"] <= zone["surface_temp_before"]
        if district != "all":
            assert zone["district"] == district
    assert result["summary"]["population_covered"] == sum(z["population"] for z in result["zones"])
    assert result["summary"]["co2_tons_year"] == pytest.approx(sum(z["co2_tons_year"] for z in result["zones"]))
    cost = result["costs"]
    assert cost["first_year_total"] == cost["planting"] + cost["annual_care"] + cost["equipment"] + cost["annual_platform"]


def test_effect_dimensions_monotonicity_and_zero_case(zones):
    z = zones[0]
    r = {"air_temp_c": 30, "surface_temp_c": 40, "wind_speed": 2, "pm25": 50}
    a = ecological_effect(z, r, 0, "elm", 10)
    b = ecological_effect(z, r, 100, "elm", 10)
    c = ecological_effect(z, r, 200, "elm", 10)
    assert a["pm25_reduction"] == a["co2_tons_year"] == a["cooling_c"] == 0
    assert 0 < b["pm25_reduction"] < c["pm25_reduction"]
    assert c["pm25_reduction"] - b["pm25_reduction"] <= b["pm25_reduction"]
    assert b["co2_tons_year"] == pytest.approx(100 * .85 * 22 / 1000)
    cold = ecological_effect(z, {**r, "air_temp_c": -10}, 100, "elm", 10)
    assert cold["cooling_c"] == 0
    assert cold["pm25_reduction"] < b["pm25_reduction"]


def test_empty_optimizer_has_no_fabricated_population(zones):
    result = optimize(OptimizeRequest(), zones, {}, {})
    assert result["zones"] == []
    assert result["used_trees"] == 0 and result["unused_trees"] == 1000
    assert result["summary"]["population_covered"] == 0
