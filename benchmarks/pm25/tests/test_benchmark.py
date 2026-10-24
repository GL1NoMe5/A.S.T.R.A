from __future__ import annotations

from copy import deepcopy
from datetime import UTC, datetime
import hashlib
import json
from pathlib import Path

BENCHMARK_DIR = Path(__file__).resolve().parents[1]
PROJECT_ROOT = BENCHMARK_DIR.parent.parent

import numpy as np
import pandas as pd
import pytest

from app.core.zones import make_zones
from app.ml.engine import FEATURES, training_data
from app.services.simulator import simulate_reading
from benchmarks.pm25.benchmark import METRICS_OUT_PATH, PROTOCOL_PATH, load_protocol, make_step_masks, rank_candidates
from benchmarks.pm25.candidate import (
    DirectLGBMForecaster,
    PersistencePM25Forecaster,
    ResidualLGBMForecaster,
    build_pm25_forecaster,
    clip_esi,
    clip_pm25,
)


@pytest.fixture(scope="module")
def zones_and_data():
    zones = make_zones()
    data, targets, persistence, steps = training_data(zones, seed=42)
    return zones, data, targets, persistence, steps


def test_protocol_temporal_splits_and_zone_grouping(zones_and_data):
    zones, data, _, _, steps = zones_and_data
    protocol = load_protocol(PROTOCOL_PATH)
    assert len(zones) == protocol["zones_per_step"] == 40
    assert len(data) == 5000
    assert list(data.columns) == FEATURES == protocol["features"]

    expected_rows = [
        (2000, 640),
        (2640, 640),
        (3280, 640),
    ]
    for split_cfg, (exp_tr, exp_val) in zip(protocol["validation_splits"], expected_rows, strict=True):
        tr_mask, val_mask, info = make_step_masks(
            steps,
            split_cfg["train_step_min"],
            split_cfg["train_step_max"],
            split_cfg["val_step_min"],
            split_cfg["val_step_max"],
            zones_per_step=40,
        )
        assert info["train_rows"] == exp_tr
        assert info["eval_rows"] == exp_val
        # Strict target non-leakage condition: max(train_step + 1) < min(validation_step)
        assert int(steps[tr_mask].max() + 1) < int(steps[val_mask].min())
        assert not np.any(steps == split_cfg["skipped_step"]) or (
            not np.any(tr_mask & (steps == split_cfg["skipped_step"]))
            and not np.any(val_mask & (steps == split_cfg["skipped_step"]))
        )

    ctrl = protocol["legacy_control_split"]
    tr_ctrl, ev_ctrl, ctrl_info = make_step_masks(
        steps, ctrl["train_step_min"], ctrl["train_step_max"], ctrl["eval_step_min"], ctrl["eval_step_max"]
    )
    assert ctrl_info["train_rows"] == 3960
    assert ctrl_info["eval_rows"] == 1000
    assert int(steps[tr_ctrl].max() + 1) < int(steps[ev_ctrl].min())


def test_split_validator_rejects_leakage_and_partial_zone_steps(zones_and_data):
    _, _, _, _, steps = zones_and_data
    # Zero skipped step -> max(train_step + 1) == 50 == min(eval_step) must fail
    with pytest.raises(ValueError, match="Temporal gap violated"):
        make_step_masks(steps, 0, 49, 50, 65, zones_per_step=40)

    # Corrupting one row's step breaks 40-zone synchronous grouping
    broken_steps = steps.copy()
    broken_steps[0] = 999
    with pytest.raises(ValueError, match="partially split"):
        make_step_masks(broken_steps, 0, 49, 51, 66, zones_per_step=40)


def test_reproducibility_shapes_finiteness_and_no_input_mutation(zones_and_data):
    zones, data, targets, _, steps = zones_and_data
    protocol = load_protocol(PROTOCOL_PATH)
    tr_mask, val_mask, _ = make_step_masks(steps, 0, 49, 51, 66)

    x_train = data.loc[tr_mask].copy(deep=True)
    y_train = targets[tr_mask, 0].copy()
    x_val = data.loc[val_mask].copy(deep=True)

    x_train_before = x_train.copy(deep=True)
    y_train_before = y_train.copy()
    x_val_before = x_val.copy(deep=True)

    for spec in [*protocol["baselines"], *protocol["candidates"]]:
        m1 = build_pm25_forecaster(spec, seed=42).fit(x_train, y_train)
        m2 = build_pm25_forecaster(spec, seed=42).fit(x_train, y_train)

        raw1 = m1.predict_raw(x_val)
        raw2 = m2.predict_raw(x_val)
        clip1 = m1.predict_clipped(x_val)

        assert raw1.shape == (640,)
        assert clip1.shape == (640,)
        assert np.all(np.isfinite(raw1))
        assert np.all(np.isfinite(clip1))
        assert np.all(clip1 >= 0.0)
        np.testing.assert_array_equal(raw1, raw2)

    # Confirm inputs were never mutated
    pd.testing.assert_frame_equal(x_train, x_train_before)
    pd.testing.assert_frame_equal(x_val, x_val_before)
    np.testing.assert_array_equal(y_train, y_train_before)
    assert len(zones) == 40


def test_pm25_and_esi_clipping_bounds():
    raw_pm = np.array([-3.2, -0.001, 0.0, 14.5])
    clipped_pm = clip_pm25(raw_pm)
    np.testing.assert_array_equal(clipped_pm, np.array([0.0, 0.0, 0.0, 14.5]))
    assert clip_pm25(-1.5) == 0.0

    raw_esi = np.array([-5.0, 0.0, 42.3, 108.9])
    clipped_esi = clip_esi(raw_esi)
    np.testing.assert_array_equal(clipped_esi, np.array([0.0, 0.0, 42.3, 100.0]))
    assert clip_esi(120.0) == 100.0
    assert clip_esi(-2.0) == 0.0


def test_single_batch_enrich_and_composite_shap_exact_additivity(zones_and_data):
    zones, data, targets, _, steps = zones_and_data
    zones_by_id = {z["id"]: z for z in zones}
    protocol = load_protocol(PROTOCOL_PATH)
    tr_mask, _, _ = make_step_masks(steps, 0, 98, 100, 124)

    bg = {
        "air": {
            "values": {"pm25": 22.0, "pm10": 35.0, "no2": 20.0, "co": 250.0},
            "status": "default",
            "source_time": None,
        },
        "weather": {
            "values": {"air_temp_c": 12.0, "humidity": 55.0, "wind_speed": 3.0, "wind_direction": 240},
            "status": "default",
            "source_time": None,
        },
    }
    rng = np.random.default_rng(42)
    readings = [simulate_reading(z, datetime(2026, 7, 1, 8, tzinfo=UTC), bg, rng) for z in zones]
    readings_snapshot = deepcopy(readings)

    cand_spec = next(c for c in protocol["candidates"] if c["id"] == "conservative_residual_lgbm_l1")
    model = build_pm25_forecaster(cand_spec, seed=42).fit(data.loc[tr_mask], targets[tr_mask, 0])
    assert isinstance(model, ResidualLGBMForecaster)

    enriched = model.enrich_pm25_batch(readings, zones_by_id)
    assert readings == readings_snapshot
    assert len(enriched) == 40
    for item in enriched:
        assert np.isfinite(item["predicted_pm25"])
        assert item["predicted_pm25"] >= 0.0
        assert item["prediction_horizon_hours"] == 3

    # Verify composite SHAP exact additivity to FULL prediction_raw (not delta alone)
    for r in readings[:8]:
        exp = model.explain_pm25(r, zones_by_id)
        reconstructed = exp["base_value"] + sum(f["contribution"] for f in exp["features"])
        assert len(exp["features"]) == len(FEATURES)
        assert reconstructed == pytest.approx(exp["prediction_raw"], abs=1e-6)
        assert exp["additivity_error"] < 1e-6
        # Full prediction_raw is around current PM2.5 (~15..30), whereas delta alone is near 0
        assert exp["prediction_raw"] > 5.0

    # Also check clipping flag when current pm25 is near zero and predicted delta is negative
    low_reading = {**readings[0], "pm25": 0.01, "pm10": 0.02, "traffic_index": 0.99}
    low_exp = model.explain_pm25(low_reading, zones_by_id)
    assert low_exp["base_value"] + sum(f["contribution"] for f in low_exp["features"]) == pytest.approx(
        low_exp["prediction_raw"], abs=1e-6
    )
    assert low_exp["prediction"] >= 0.0
    if low_exp["prediction_raw"] < 0.0:
        assert low_exp["clipping_applied"] is True
        assert low_exp["prediction"] == 0.0


def test_production_artifact_untouched_and_metrics_file_consistent():
    prod_model_path = PROJECT_ROOT / "data" / "models.joblib"
    digest_before = hashlib.sha256(prod_model_path.read_bytes()).hexdigest() if prod_model_path.exists() else None

    assert METRICS_OUT_PATH.exists(), "Run benchmark.py first to generate results/metrics.json"
    metrics = json.loads(METRICS_OUT_PATH.read_text(encoding="utf-8"))
    protocol = load_protocol(PROTOCOL_PATH)

    assert metrics["protocol_summary"]["production_artifact_untouched"] is True
    b = metrics["baseline_reproduction_seed42"]
    assert b["pm25"]["current_lgbm"]["mae_raw"] == pytest.approx(2.8309, abs=1e-3)
    assert b["pm25"]["persistence"]["mae_raw"] == pytest.approx(2.6061, abs=1e-3)
    assert b["esi"]["current_lgbm"]["mae_raw"] == pytest.approx(1.2215, abs=1e-3)
    assert b["esi"]["persistence"]["mae_raw"] == pytest.approx(1.8619, abs=1e-3)

    expected_variants = {s["id"] for s in [*protocol["baselines"], *protocol["candidates"]]}
    assert set(metrics["validation_selection_seed42"]["variants"].keys()) == expected_variants

    digest_after = hashlib.sha256(prod_model_path.read_bytes()).hexdigest() if prod_model_path.exists() else None
    assert digest_before == digest_after


def test_candidate_ranking_honors_all_registered_tie_breakers():
    # Deliberately reverse the desired order: ties cannot pass by declaration order.
    entries = [
        ("more_trees", 1.0, 2.0, 4, 80),
        ("more_leaves", 1.0, 2.0, 7, 20),
        ("worse_max", 1.0, 3.0, 2, 10),
        ("best", 1.0, 2.0, 4, 40),
        ("best_mean", 0.9, 4.0, 15, 100),
        ("same_as_best", 1.0, 2.0, 4, 40),
    ]
    protocol = {"candidates": [
        {"id": name, "params": {"num_leaves": leaves, "n_estimators": trees}}
        for name, _, _, leaves, trees in entries
    ]}
    validation = {name: {"summary": {"mean_mae_clipped": mean, "max_mae_clipped": worst}}
                  for name, mean, worst, _, _ in entries}
    assert rank_candidates(protocol, validation) == [
        "best_mean", "best", "same_as_best", "more_trees", "more_leaves", "worse_max"
    ]


def test_residual_shap_uses_same_training_background_for_both_terms(zones_and_data):
    _, data, targets, _, steps = zones_and_data
    train, _, _ = make_step_masks(steps, 0, 49, 51, 66)
    spec = next(c for c in load_protocol()["candidates"] if c["id"] == "conservative_residual_lgbm_l1")
    model = build_pm25_forecaster(spec, seed=42).fit(data.loc[train], targets[train, 0])
    expected_background = data.loc[train].sample(n=100, random_state=42)
    pd.testing.assert_frame_equal(model.background, expected_background)
    np.testing.assert_array_equal(model.explainer.data, expected_background.to_numpy())
    assert model.explainer.feature_perturbation == "interventional"
    assert model.train_pm25_mean == pytest.approx(expected_background["pm25"].mean())
    base_full = model.train_pm25_mean + float(model.explainer.expected_value)
    assert base_full == pytest.approx(model.predict_raw(expected_background).mean(), abs=1e-8)
