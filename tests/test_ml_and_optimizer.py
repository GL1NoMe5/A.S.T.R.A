from copy import deepcopy
from datetime import UTC, datetime

import numpy as np
import pytest

from app.ml.engine import FEATURES, MLEngine, training_data
from app.ml.optimizer import SPECIES, ecological_effect, optimize, select_sites
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
    pm25 = ml.metrics["targets"]["pm25"]
    assert pm25["mae"] == pm25["persistence_mae"]
    assert np.isfinite(pm25["ml_mae"]) and pm25["ml_mae"] >= 0


def test_model_artifact_reused(ml, zones):
    original_mtime = ml.path.stat().st_mtime_ns
    reloaded = MLEngine(ml.path.parent, zones)
    reloaded.initialize()
    assert reloaded.metrics == ml.metrics
    assert ml.path.stat().st_mtime_ns == original_mtime


@pytest.mark.parametrize("target,method", [("pm25", "ml"), ("esi", "primary")])
def test_shap_exact_additivity(ml, zones, tmp_path, target, method):
    readings, _ = readings_for(zones, ml, tmp_path)
    explanation = ml.explain(readings[zones[0]["id"]], target, method=method)
    reconstructed = explanation["base_value"] + sum(f["contribution"] for f in explanation["features"])
    assert reconstructed == pytest.approx(explanation["prediction_raw"], abs=1e-5)
    assert len(explanation["features"]) == len(FEATURES)
    assert explanation["additivity_error"] < 1e-5
    assert explanation["explanation_kind"] == "tree_shap"
    assert explanation["forecast_method"] == "lightgbm"
    prediction_field = "predicted_pm25_ml" if target == "pm25" else "predicted_esi"
    assert round(explanation["prediction"], 3) == readings[zones[0]["id"]][prediction_field]


def test_primary_pm25_rule_and_experimental_ml_do_not_mutate_input(ml, zones, tmp_path):
    bg = BackgroundService(Settings(data_dir=tmp_path, background_enabled=False)).snapshot()
    rng = np.random.default_rng(42)
    raw = [simulate_reading(z, datetime(2026, 7, 1, 8, tzinfo=UTC), bg, rng) for z in zones]
    original = deepcopy(raw)
    enriched = ml.enrich(raw)
    assert raw == original
    assert len(enriched) == 40
    assert any(r["predicted_pm25"] != r["predicted_pm25_ml"] for r in enriched)
    for reading in enriched:
        assert reading["predicted_pm25"] == round(max(0, reading["pm25"]), 3)
        assert np.isfinite(reading["predicted_pm25_ml"]) and reading["predicted_pm25_ml"] >= 0
        assert reading["prediction_kind"] == "mixed_forecast"
        assert reading["prediction_methods"] == {
            "pm25": "persistence", "pm25_ml": "lightgbm", "esi": "lightgbm"}
    enriched_before_explanation = deepcopy(enriched)
    explanation = ml.explain(enriched[0], "pm25")
    assert explanation["explanation_kind"] == "persistence_rule"
    assert explanation["forecast_method"] == "persistence"
    assert explanation["base_value"] == 0
    assert explanation["prediction"] == original[0]["pm25"]
    assert explanation["prediction_raw"] == original[0]["pm25"]
    assert explanation["additivity_error"] == 0
    assert len(explanation["features"]) == 1
    assert explanation["features"][0]["feature"] == "pm25"
    assert explanation["features"][0]["contribution"] == original[0]["pm25"]
    assert raw == original
    assert enriched == enriched_before_explanation


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
    eligible = [z for z in zones if district == "all" or z["district"] == district]
    assert len(result["zones"]) <= len(eligible)
    assert result["used_trees"] == min(budget, sum(z["planting_capacity"] for z in eligible))
    if budget == 10000 and district == "all":
        assert len(result["zones"]) > 10
        assert result["unused_trees"] == 0
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
    cold = ecological_effect(z, {**r, "air_temp_c": -10, "surface_temp_c": -5}, 100, "elm", 10)
    assert 0 < cold["cooling_c"] < b["cooling_c"]
    assert cold["pm25_reduction"] < b["pm25_reduction"]


@pytest.mark.parametrize("species", list(SPECIES))
def test_surface_heat_and_summer_reference(zones, species):
    site = zones[0]
    reading = {"air_temp_c": 1.6, "surface_temp_c": 1.2, "wind_speed": 2, "pm25": 20}
    night = ecological_effect(site, reading, 260, species, 30)
    assert night["cooling_c"] == 0
    sunny = ecological_effect(site, {**reading, "surface_temp_c": 1.61}, 260, species, 30)
    assert 0 < sunny["cooling_c"] < 0.01
    summer = ecological_effect(site, reading, 260, species, 30, "summer_day")
    assert summer["surface_temp_before"] == 38
    assert 28 < summer["surface_temp_after"] < 38
    assert summer["surface_temp_before"] - summer["surface_temp_after"] == pytest.approx(summer["cooling_c"])
    assert summer["pm25_after"] == night["pm25_after"]


def test_summer_plan_uses_thermal_scenario_in_allocation_and_summary(zones):
    readings = {z["id"]: {"pm25": 30, "predicted_pm25": 31, "predicted_esi": 40,
                "air_temp_c": 1.6, "surface_temp_c": 1.2, "wind_speed": 2} for z in zones}
    req = OptimizeRequest(budget_trees=10000, horizon_years=30, thermal_scenario="summer_day")
    plan = optimize(req, zones, readings, {})
    assert plan["request"]["thermal_scenario"] == "summer_day"
    assert all(z["priority_inputs"]["heat_above_25_c"] == 13 for z in plan["zones"])
    assert all(z["cooling_c"] > 0 for z in plan["zones"])
    assert plan["summary"]["surface_temp_before"] == pytest.approx(38)
    assert plan["summary"]["surface_temp_after"] < 38


def test_large_budget_expands_priority_pool_and_accounts_for_every_site(zones):
    readings = {z["id"]: {"pm25": 20 + i, "predicted_pm25": 20 + i, "predicted_esi": 40,
                "air_temp_c": 28, "surface_temp_c": 38, "wind_speed": 1 + i % 3}
                for i, z in enumerate(zones)}
    request = OptimizeRequest(budget_trees=10000, horizon_years=30, thermal_scenario="summer_day",
                              sapling_cost_kzt=12300, planting_cost_kzt=7900,
                              annual_care_cost_kzt=2300, pilot_equipment_cost_kzt=400000,
                              annual_platform_cost_kzt=850000)
    initial, _, _ = select_sites(OptimizeRequest(budget_trees=1000, thermal_scenario="summer_day"),
                                 zones, readings)
    expanded, _, _ = select_sites(request, zones, readings)
    assert len(initial) == 10
    assert expanded[:10] == initial
    assert sum(z["planting_capacity"] for z in expanded) >= 10000
    assert sum(z["planting_capacity"] for z in expanded[:-1]) < 10000

    plan = optimize(request, zones, readings, {})
    assert plan["used_trees"] == 10000 and plan["unused_trees"] == 0
    assert plan["allocation"] == {
        "eligible_sites": 40, "eligible_capacity_trees": 16600,
        "selected_sites": len(expanded),
        "selected_capacity_trees": sum(z["planting_capacity"] for z in expanded),
        "unused_reason": None,
    }
    planted = plan["zones"]
    assert any(z["priority_inputs"]["selection_rank"] > 10 for z in planted)
    area = sum(z["area_m2"] for z in planted)
    for key in ("pm25_before", "pm25_after", "pm25_reduction", "surface_temp_before",
                "surface_temp_after", "cooling_c"):
        assert plan["summary"][key] == pytest.approx(sum(z[key] * z["area_m2"] for z in planted) / area)
    assert plan["summary"]["co2_tons_year"] == pytest.approx(10000 * .85 * 22 / 1000)
    assert plan["summary"]["population_covered"] == sum(z["population"] for z in planted)
    assert sum(z["surviving_trees"] for z in planted) == pytest.approx(8500)
    assert plan["costs"]["planting"] == 10000 * (12300 + 7900)
    assert plan["costs"]["annual_care"] == 10000 * 2300
    assert plan["costs"]["first_year_total"] == 10000 * (12300 + 7900 + 2300) + 400000 + 850000
    assert plan["costs"]["horizon_total"] == 10000 * (12300 + 7900) + 400000 + 30 * (10000 * 2300 + 850000)


def test_unallocated_budget_only_after_available_territory_is_full(zones):
    readings = {z["id"]: {"pm25": 30, "predicted_pm25": 30, "predicted_esi": 40,
                "air_temp_c": 28, "surface_temp_c": 38, "wind_speed": 2} for z in zones}
    # An unavailable site's space cannot be silently used, nor can another district.
    missing = next(z for z in zones if z["district"] == "yesil")
    readings.pop(missing["id"])
    req = OptimizeRequest(budget_trees=10000, target_district="yesil")
    plan = optimize(req, zones, readings, {})
    eligible = [z for z in zones if z["district"] == "yesil" and z["id"] in readings]
    capacity = sum(z["planting_capacity"] for z in eligible)
    assert plan["used_trees"] == capacity
    assert plan["unused_trees"] == 10000 - capacity
    assert {z["id"] for z in plan["zones"]} == {z["id"] for z in eligible}
    assert all(z["trees"] == z["planting_capacity"] for z in plan["zones"])
    assert plan["allocation"]["eligible_capacity_trees"] == capacity
    assert plan["allocation"]["selected_capacity_trees"] == capacity
    assert plan["allocation"]["unused_reason"] == "territory_capacity"


def test_empty_optimizer_has_no_fabricated_population(zones):
    result = optimize(OptimizeRequest(), zones, {}, {})
    assert result["zones"] == []
    assert result["used_trees"] == 0 and result["unused_trees"] == 1000
    assert result["summary"]["population_covered"] == 0
    assert result["allocation"]["unused_reason"] == "no_eligible_sites"
    assert result["allocation"]["eligible_capacity_trees"] == 0


def test_priority_explanation_preserves_inputs_and_baseline(zones):
    readings = {z["id"]: {"pm25": 30, "predicted_pm25": 31, "predicted_esi": 40,
                "air_temp_c": 28, "surface_temp_c": 35, "wind_speed": 2} for z in zones}
    result = optimize(OptimizeRequest(budget_trees=100), zones, readings, {})
    for z in result["zones"]:
        inputs = z["priority_inputs"]
        expected = (31 + 2 * 10 + 40 / 5) * (1 - z["ndvi"]) * (z["population"] / 1000) ** .5
        assert z["priority_score"] == pytest.approx(expected)
        assert inputs["heat_above_25_c"] == 10
        assert 0 <= inputs["proximity_bonus_pct"] <= 12
        assert 1 <= inputs["selection_rank"] <= 10
        readings[z["id"]]["predicted_pm25"] = 999
        assert inputs["predicted_pm25"] == 31
    s = result["summary"]
    assert s["pm25_before"] == 30
    assert s["surface_temp_before"] == 35
    assert s["pm25_before"] - s["pm25_after"] == pytest.approx(s["pm25_reduction"])
    assert s["surface_temp_before"] - s["surface_temp_after"] == pytest.approx(s["cooling_c"])
