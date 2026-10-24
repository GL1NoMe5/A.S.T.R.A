"""Reproducible evaluation benchmark for ASTRA 3-hour PM2.5 forecasting.

Run from project root:
    .\\.venv\\Scripts\\python.exe -m benchmarks.pm25.benchmark
"""
from __future__ import annotations

from datetime import UTC, datetime
import json
from pathlib import Path
import platform
import statistics
import sys
import time
from typing import Any

BENCHMARK_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = BENCHMARK_DIR.parent.parent

import lightgbm
from lightgbm import LGBMRegressor
import numpy as np
import pandas as pd
import shap
import sklearn
from sklearn.metrics import mean_absolute_error

from app.core.zones import make_zones
from app.ml.engine import FEATURES, MODEL_VERSION, training_data
from app.services.simulator import simulate_reading
from .candidate import build_pm25_forecaster, clip_esi, clip_pm25


PROTOCOL_PATH = BENCHMARK_DIR / "protocol.json"
METRICS_OUT_PATH = BENCHMARK_DIR / "results" / "metrics.json"


def load_protocol(path: Path = PROTOCOL_PATH) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def rank_candidates(protocol: dict[str, Any], validation: dict[str, Any]) -> list[str]:
    """Rank ML candidates only; persistence remains a separate acceptance gate.

    After mean and worst-fold MAE, prefer fewer leaves, then fewer trees.
    An identical configuration keeps protocol order (Python's stable sort).
    """
    def rank_key(spec: dict[str, Any]) -> tuple[float, float, int, int]:
        summary = validation[spec["id"]]["summary"]
        return (
            summary["mean_mae_clipped"],
            summary["max_mae_clipped"],
            int(spec["params"]["num_leaves"]),
            int(spec["params"]["n_estimators"]),
        )

    return [spec["id"] for spec in sorted(protocol["candidates"], key=rank_key)]


def make_step_masks(
    steps: np.ndarray,
    train_min: int,
    train_max: int,
    eval_min: int,
    eval_max: int,
    zones_per_step: int = 40,
) -> tuple[np.ndarray, np.ndarray, dict[str, int]]:
    """Build and strictly validate temporal split masks."""
    train_mask = (steps >= train_min) & (steps <= train_max)
    eval_mask = (steps >= eval_min) & (steps <= eval_max)

    if not np.any(train_mask) or not np.any(eval_mask):
        raise ValueError("Train or evaluation mask is empty.")
    if np.any(train_mask & eval_mask):
        raise ValueError("Train and evaluation masks overlap.")

    # Verify all 40 zones of each step stay together without partial splitting
    for step_val in np.unique(steps):
        tr_count = int(np.sum(train_mask & (steps == step_val)))
        ev_count = int(np.sum(eval_mask & (steps == step_val)))
        if tr_count not in (0, zones_per_step):
            raise ValueError(f"Step {step_val} partially split in train ({tr_count}/{zones_per_step}).")
        if ev_count not in (0, zones_per_step):
            raise ValueError(f"Step {step_val} partially split in eval ({ev_count}/{zones_per_step}).")

    max_train_feature_step = int(steps[train_mask].max())
    max_train_target_step = max_train_feature_step + 1
    min_eval_feature_step = int(steps[eval_mask].min())

    if not (max_train_target_step < min_eval_feature_step):
        raise ValueError(
            f"Temporal gap violated: max(train_step + 1)={max_train_target_step} "
            f"is not < min(eval_step)={min_eval_feature_step}"
        )

    info = {
        "train_rows": int(train_mask.sum()),
        "eval_rows": int(eval_mask.sum()),
        "train_step_min": int(steps[train_mask].min()),
        "train_step_max": max_train_feature_step,
        "train_last_target_step": max_train_target_step,
        "eval_step_min": min_eval_feature_step,
        "eval_step_max": int(steps[eval_mask].max()),
        "gap_steps_between_target_and_eval_feature": min_eval_feature_step - max_train_target_step,
    }
    return train_mask, eval_mask, info


def compute_pm25_metrics(y_true: np.ndarray, y_pred_raw: np.ndarray) -> dict[str, float | int]:
    y_true_arr = np.asarray(y_true, dtype=float)
    raw_arr = np.asarray(y_pred_raw, dtype=float)
    clipped_arr = np.asarray(clip_pm25(raw_arr), dtype=float)
    rounded_arr = np.round(clipped_arr, 3)
    return {
        "mae_raw": round(float(mean_absolute_error(y_true_arr, raw_arr)), 6),
        "mae_clipped": round(float(mean_absolute_error(y_true_arr, clipped_arr)), 6),
        "mae_clipped_round3": round(float(mean_absolute_error(y_true_arr, rounded_arr)), 6),
        "clipped_below_zero_count": int(np.sum(raw_arr < 0.0)),
        "pred_min_raw": round(float(raw_arr.min()), 6),
        "pred_max_raw": round(float(raw_arr.max()), 6),
    }


def compute_esi_metrics(y_true: np.ndarray, y_pred_raw: np.ndarray) -> dict[str, float | int]:
    y_true_arr = np.asarray(y_true, dtype=float)
    raw_arr = np.asarray(y_pred_raw, dtype=float)
    clipped_arr = np.asarray(clip_esi(raw_arr), dtype=float)
    rounded_arr = np.round(clipped_arr, 3)
    return {
        "mae_raw": round(float(mean_absolute_error(y_true_arr, raw_arr)), 6),
        "mae_clipped": round(float(mean_absolute_error(y_true_arr, clipped_arr)), 6),
        "mae_clipped_round3": round(float(mean_absolute_error(y_true_arr, rounded_arr)), 6),
        "clipped_out_of_bounds_count": int(np.sum((raw_arr < 0.0) | (raw_arr > 100.0))),
    }


def evaluate_esi_unchanged(
    data: pd.DataFrame,
    targets: np.ndarray,
    persistence: np.ndarray,
    train_mask: np.ndarray,
    eval_mask: np.ndarray,
    seed: int,
) -> dict[str, Any]:
    """Reproduce unchanged ESI model metrics from app/ml/engine.py in memory."""
    esi_model = LGBMRegressor(
        n_estimators=100,
        num_leaves=15,
        max_depth=5,
        learning_rate=0.07,
        reg_lambda=1,
        n_jobs=2,
        random_state=seed,
        verbosity=-1,
    )
    esi_model.fit(data.loc[train_mask], targets[train_mask, 1])
    esi_pred_raw = np.asarray(esi_model.predict(data.loc[eval_mask]), dtype=float)
    esi_pers_raw = np.asarray(persistence[eval_mask, 1], dtype=float)
    return {
        "current_lgbm": compute_esi_metrics(targets[eval_mask, 1], esi_pred_raw),
        "persistence": compute_esi_metrics(targets[eval_mask, 1], esi_pers_raw),
    }


def profile_timings(
    selected_spec: dict[str, Any],
    current_spec: dict[str, Any],
    zones: list[dict[str, Any]],
    data: pd.DataFrame,
    targets: np.ndarray,
    train_mask: np.ndarray,
    seed: int,
) -> dict[str, Any]:
    """Measure training, 40-station batch enrich, and SHAP latency via time.perf_counter."""
    zones_by_id = {z["id"]: z for z in zones}
    x_train = data.loc[train_mask]
    y_train = targets[train_mask, 0]

    bg = {
        "air": {
            "values": {"pm25": 24.0, "pm10": 38.0, "no2": 22.0, "co": 260.0},
            "status": "default",
            "source_time": None,
        },
        "weather": {
            "values": {"air_temp_c": 14.0, "humidity": 52.0, "wind_speed": 3.5, "wind_direction": 240},
            "status": "default",
            "source_time": None,
        },
    }
    rng = np.random.default_rng(seed)
    stamp = datetime(2026, 7, 1, 8, tzinfo=UTC)
    batch_readings = [simulate_reading(z, stamp, bg, rng) for z in zones]

    def measure_variant(spec: dict[str, Any]) -> dict[str, Any]:
        # Warmup fit
        warm = build_pm25_forecaster(spec, seed)
        warm.fit(x_train, y_train)

        fit_ms: list[float] = []
        fitted_model = warm
        for _ in range(7):
            m = build_pm25_forecaster(spec, seed)
            t0 = time.perf_counter()
            m.fit(x_train, y_train)
            fit_ms.append((time.perf_counter() - t0) * 1000.0)
            fitted_model = m

        # Warmup batch enrich (40 stations)
        for _ in range(3):
            fitted_model.enrich_pm25_batch(batch_readings, zones_by_id)

        batch_ms: list[float] = []
        for _ in range(50):
            t0 = time.perf_counter()
            fitted_model.enrich_pm25_batch(batch_readings, zones_by_id)
            batch_ms.append((time.perf_counter() - t0) * 1000.0)

        # Warmup SHAP explain (includes TreeExplainer init prior to steady-state calls)
        t_init0 = time.perf_counter()
        first_exp = fitted_model.explain_pm25(batch_readings[0], zones_by_id)
        explainer_first_call_ms = (time.perf_counter() - t_init0) * 1000.0

        explain_ms: list[float] = []
        max_additivity_err = float(first_exp["additivity_error"])
        for i in range(40):
            t0 = time.perf_counter()
            exp = fitted_model.explain_pm25(batch_readings[i], zones_by_id)
            explain_ms.append((time.perf_counter() - t0) * 1000.0)
            max_additivity_err = max(max_additivity_err, float(exp["additivity_error"]))

        return {
            "train_3960_rows_ms": {
                "median": round(statistics.median(fit_ms), 3),
                "mean": round(statistics.mean(fit_ms), 3),
                "min": round(min(fit_ms), 3),
                "max": round(max(fit_ms), 3),
                "runs": 7,
                "warmup_runs": 1,
            },
            "enrich_batch_40_zones_ms": {
                "median": round(statistics.median(batch_ms), 4),
                "mean": round(statistics.mean(batch_ms), 4),
                "min": round(min(batch_ms), 4),
                "max": round(max(batch_ms), 4),
                "runs": 50,
                "warmup_runs": 3,
            },
            "explain_single_station_ms": {
                "first_call_with_init_ms": round(explainer_first_call_ms, 3),
                "steady_median_ms": round(statistics.median(explain_ms), 4),
                "steady_mean_ms": round(statistics.mean(explain_ms), 4),
                "runs": 40,
            },
            "shap_max_additivity_error_across_40_zones": max_additivity_err,
        }

    return {
        "measurement_method": (
            "Wall-clock elapsed time via time.perf_counter() in-process on CPU (n_jobs=2), "
            "excluding library imports and synthetic dataset generation. "
            "Batch timing covers feature_row() extraction for 40 zones + DataFrame creation + predict + PM2.5 >= 0 clipping."
        ),
        "current_lgbm": measure_variant(current_spec),
        "selected_candidate": measure_variant(selected_spec),
    }


def run_benchmark(write_output: bool = True) -> dict[str, Any]:
    protocol = load_protocol()
    primary_seed = int(protocol["primary_seed"])
    zones_per_step = int(protocol["zones_per_step"])

    # Guard check: ensure data/models.joblib is never touched
    prod_artifact = PROJECT_ROOT / "data" / "models.joblib"
    artifact_mtime_before = prod_artifact.stat().st_mtime_ns if prod_artifact.exists() else None

    zones = make_zones()
    data_42, targets_42, persistence_42, steps_42 = training_data(zones, seed=primary_seed)

    ctrl_cfg = protocol["legacy_control_split"]
    ctrl_train_mask, ctrl_eval_mask, ctrl_split_info = make_step_masks(
        steps_42,
        ctrl_cfg["train_step_min"],
        ctrl_cfg["train_step_max"],
        ctrl_cfg["eval_step_min"],
        ctrl_cfg["eval_step_max"],
        zones_per_step=zones_per_step,
    )

    all_specs = [*protocol["baselines"], *protocol["candidates"]]
    specs_by_id = {s["id"]: s for s in all_specs}

    # Step 1: Reproduce baseline (seed=42, steps 0..98 -> 100..124)
    current_ctrl_model = build_pm25_forecaster(specs_by_id["current_lgbm"], primary_seed)
    current_ctrl_model.fit(data_42.loc[ctrl_train_mask], targets_42[ctrl_train_mask, 0])
    current_ctrl_raw = current_ctrl_model.predict_raw(data_42.loc[ctrl_eval_mask])

    pers_ctrl_model = build_pm25_forecaster(specs_by_id["persistence"], primary_seed)
    pers_ctrl_model.fit(data_42.loc[ctrl_train_mask], targets_42[ctrl_train_mask, 0])
    pers_ctrl_raw = pers_ctrl_model.predict_raw(data_42.loc[ctrl_eval_mask])

    baseline_reproduction = {
        "seed": primary_seed,
        "split": ctrl_split_info,
        "pm25": {
            "current_lgbm": compute_pm25_metrics(targets_42[ctrl_eval_mask, 0], current_ctrl_raw),
            "persistence": compute_pm25_metrics(targets_42[ctrl_eval_mask, 0], pers_ctrl_raw),
        },
        "esi": evaluate_esi_unchanged(
            data_42, targets_42, persistence_42, ctrl_train_mask, ctrl_eval_mask, primary_seed
        ),
    }

    # Step 2 & 3: Evaluate all pre-registered variants on the 3 expanding validation splits (seed=42)
    validation_splits_meta: list[dict[str, Any]] = []
    validation_by_variant: dict[str, dict[str, Any]] = {s["id"]: {"splits": {}} for s in all_specs}

    for split_cfg in protocol["validation_splits"]:
        tr_mask, val_mask, split_info = make_step_masks(
            steps_42,
            split_cfg["train_step_min"],
            split_cfg["train_step_max"],
            split_cfg["val_step_min"],
            split_cfg["val_step_max"],
            zones_per_step=zones_per_step,
        )
        validation_splits_meta.append({"name": split_cfg["name"], **split_info})

        x_tr = data_42.loc[tr_mask]
        y_tr = targets_42[tr_mask, 0]
        x_val = data_42.loc[val_mask]
        y_val = targets_42[val_mask, 0]

        for spec in all_specs:
            forecaster = build_pm25_forecaster(spec, primary_seed)
            forecaster.fit(x_tr, y_tr)
            pred_raw = forecaster.predict_raw(x_val)
            validation_by_variant[spec["id"]]["splits"][split_cfg["name"]] = compute_pm25_metrics(
                y_val, pred_raw
            )

    for spec in all_specs:
        vid = spec["id"]
        split_clipped = [
            validation_by_variant[vid]["splits"][sc["name"]]["mae_clipped"]
            for sc in protocol["validation_splits"]
        ]
        split_raw = [
            validation_by_variant[vid]["splits"][sc["name"]]["mae_raw"]
            for sc in protocol["validation_splits"]
        ]
        validation_by_variant[vid]["summary"] = {
            "kind": spec["kind"],
            "mean_mae_clipped": round(float(np.mean(split_clipped)), 6),
            "std_mae_clipped": round(float(np.std(split_clipped, ddof=0)), 6),
            "max_mae_clipped": round(float(np.max(split_clipped)), 6),
            "min_mae_clipped": round(float(np.min(split_clipped)), 6),
            "mean_mae_raw": round(float(np.mean(split_raw)), 6),
        }

    pers_val_mean = validation_by_variant["persistence"]["summary"]["mean_mae_clipped"]
    curr_val_mean = validation_by_variant["current_lgbm"]["summary"]["mean_mae_clipped"]
    for vid, entry in validation_by_variant.items():
        m = entry["summary"]["mean_mae_clipped"]
        entry["summary"]["delta_vs_persistence_clipped"] = round(m - pers_val_mean, 6)
        entry["summary"]["delta_vs_current_lgbm_clipped"] = round(m - curr_val_mean, 6)

    # Select winning candidate strictly using the 3 validation splits
    ranked_candidates = rank_candidates(protocol, validation_by_variant)
    selected_id = ranked_candidates[0]
    selected_spec = specs_by_id[selected_id]

    # Step 4: Evaluate locked selected candidate on legacy control 100..124 and noise seeds 42, 7, 123
    all_seeds = [primary_seed, *[int(s) for s in protocol["noise_robustness_seeds"]]]
    multi_seed_results: dict[str, Any] = {}

    for seed in all_seeds:
        d_s, t_s, p_s, st_s = (
            (data_42, targets_42, persistence_42, steps_42)
            if seed == primary_seed
            else training_data(zones, seed=seed)
        )
        tr_m, ev_m, _ = make_step_masks(
            st_s,
            ctrl_cfg["train_step_min"],
            ctrl_cfg["train_step_max"],
            ctrl_cfg["eval_step_min"],
            ctrl_cfg["eval_step_max"],
            zones_per_step=zones_per_step,
        )
        x_tr_s, y_tr_s = d_s.loc[tr_m], t_s[tr_m, 0]
        x_ev_s, y_ev_s = d_s.loc[ev_m], t_s[ev_m, 0]

        seed_pm25_control: dict[str, Any] = {}
        for vid in ("persistence", "current_lgbm", selected_id):
            f_m = build_pm25_forecaster(specs_by_id[vid], seed)
            f_m.fit(x_tr_s, y_tr_s)
            seed_pm25_control[vid] = compute_pm25_metrics(y_ev_s, f_m.predict_raw(x_ev_s))

        # Also evaluate the 3 validation splits per seed for complete transparency
        seed_val_means: dict[str, float] = {}
        for vid in ("persistence", "current_lgbm", selected_id):
            vals = []
            for split_cfg in protocol["validation_splits"]:
                v_tr, v_ev, _ = make_step_masks(
                    st_s,
                    split_cfg["train_step_min"],
                    split_cfg["train_step_max"],
                    split_cfg["val_step_min"],
                    split_cfg["val_step_max"],
                    zones_per_step=zones_per_step,
                )
                fm = build_pm25_forecaster(specs_by_id[vid], seed)
                fm.fit(d_s.loc[v_tr], t_s[v_tr, 0])
                vals.append(compute_pm25_metrics(t_s[v_ev, 0], fm.predict_raw(d_s.loc[v_ev]))["mae_clipped"])
            seed_val_means[vid] = round(float(np.mean(vals)), 6)

        multi_seed_results[str(seed)] = {
            "seed": seed,
            "control_100_124_pm25": seed_pm25_control,
            "validation_3split_mean_pm25_clipped": seed_val_means,
            "control_100_124_esi_unchanged": evaluate_esi_unchanged(d_s, t_s, p_s, tr_m, ev_m, seed),
        }

    # Step 5: Timings & SHAP exact additivity
    timings_and_shap = profile_timings(
        selected_spec=selected_spec,
        current_spec=specs_by_id["current_lgbm"],
        zones=zones,
        data=data_42,
        targets=targets_42,
        train_mask=ctrl_train_mask,
        seed=primary_seed,
    )

    # Check pre-registered replacement criteria honestly
    sel_val_mean = validation_by_variant[selected_id]["summary"]["mean_mae_clipped"]
    beats_current_val = sel_val_mean < curr_val_mean
    beats_pers_val = sel_val_mean < pers_val_mean
    beats_pers_all_seeds_ctrl = all(
        multi_seed_results[str(s)]["control_100_124_pm25"][selected_id]["mae_clipped"]
        < multi_seed_results[str(s)]["control_100_124_pm25"]["persistence"]["mae_clipped"]
        for s in all_seeds
    )
    beats_current_all_seeds_ctrl = all(
        multi_seed_results[str(s)]["control_100_124_pm25"][selected_id]["mae_clipped"]
        < multi_seed_results[str(s)]["control_100_124_pm25"]["current_lgbm"]["mae_clipped"]
        for s in all_seeds
    )
    shap_ok = timings_and_shap["selected_candidate"]["shap_max_additivity_error_across_40_zones"] < 1e-5

    recommend_replacement = bool(
        beats_current_val and beats_pers_val and beats_pers_all_seeds_ctrl and shap_ok
    )

    artifact_mtime_after = prod_artifact.stat().st_mtime_ns if prod_artifact.exists() else None
    if artifact_mtime_before != artifact_mtime_after:
        raise RuntimeError("Safety violation: data/models.joblib was modified during benchmark!")

    output = {
        "generated_at_utc": datetime.now(UTC).isoformat(),
        "astra_model_version_reference": MODEL_VERSION,
        "environment": {
            "python": sys.version.split()[0],
            "platform": platform.platform(),
            "numpy": np.__version__,
            "pandas": pd.__version__,
            "scikit_learn": sklearn.__version__,
            "lightgbm": lightgbm.__version__,
            "shap": shap.__version__,
        },
        "protocol_summary": {
            "protocol_version": protocol["protocol_version"],
            "features_count": len(FEATURES),
            "features": FEATURES,
            "zones_count": len(zones),
            "total_rows_per_seed": int(len(data_42)),
            "production_artifact_untouched": artifact_mtime_before == artifact_mtime_after,
            "selection_scope": "ML candidates only; persistence is a separate acceptance gate",
            "residual_shap_background": "100 training rows sampled with model seed; common interventional background for both terms",
        },
        "baseline_reproduction_seed42": baseline_reproduction,
        "validation_selection_seed42": {
            "splits": validation_splits_meta,
            "variants": validation_by_variant,
            "ranked_candidates": ranked_candidates,
            "selected_candidate_id": selected_id,
            "selected_candidate_spec": selected_spec,
        },
        "locked_candidate_evaluation": {
            "note": (
                "Control 100..124 was already known in ASTRA and is NOT an independent holdout. "
                "Seeds 7 and 123 test stability to Gaussian observation/traffic noise under identical "
                "deterministic background weather trajectories."
            ),
            "seeds": multi_seed_results,
        },
        "applicability_and_timing": timings_and_shap,
        "recommendation": {
            "selected_candidate_id": selected_id,
            "beats_current_lgbm_on_validation_mean": beats_current_val,
            "beats_persistence_on_validation_mean": beats_pers_val,
            "beats_current_lgbm_across_seeds_42_7_123_control": beats_current_all_seeds_ctrl,
            "beats_persistence_across_seeds_42_7_123_control": beats_pers_all_seeds_ctrl,
            "shap_exact_additivity_verified": shap_ok,
            "recommend_production_replacement": recommend_replacement,
        },
    }

    if write_output:
        METRICS_OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
        METRICS_OUT_PATH.write_text(
            json.dumps(output, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )

    return output


def print_report(res: dict[str, Any]) -> None:
    b = res["baseline_reproduction_seed42"]
    print("=== 1. Baseline Reproduction (seed=42, train 0..98 [3960], control 100..124 [1000]) ===")
    print(
        f"PM2.5 current_lgbm : raw MAE = {b['pm25']['current_lgbm']['mae_raw']:.4f} | "
        f"clipped MAE = {b['pm25']['current_lgbm']['mae_clipped']:.4f}"
    )
    print(
        f"PM2.5 persistence  : raw MAE = {b['pm25']['persistence']['mae_raw']:.4f} | "
        f"clipped MAE = {b['pm25']['persistence']['mae_clipped']:.4f}"
    )
    print(
        f"ESI   current_lgbm : raw MAE = {b['esi']['current_lgbm']['mae_raw']:.4f} | "
        f"clipped MAE = {b['esi']['current_lgbm']['mae_clipped']:.4f}"
    )
    print(
        f"ESI   persistence  : raw MAE = {b['esi']['persistence']['mae_raw']:.4f} | "
        f"clipped MAE = {b['esi']['persistence']['mae_clipped']:.4f}"
    )

    print("\n=== 2. Expanding Temporal Validation Splits (seed=42, PM2.5 clipped MAE) ===")
    val = res["validation_selection_seed42"]
    split_names = [s["name"] for s in val["splits"]]
    header = f"{'Variant':<32} | {'S1 (51..66)':>11} | {'S2 (67..82)':>11} | {'S3 (83..98)':>11} | {'Mean MAE':>10}"
    print(header)
    print("-" * len(header))
    for vid, vdata in val["variants"].items():
        s1, s2, s3 = [vdata["splits"][sn]["mae_clipped"] for sn in split_names]
        mean_v = vdata["summary"]["mean_mae_clipped"]
        print(f"{vid:<32} | {s1:11.4f} | {s2:11.4f} | {s3:11.4f} | {mean_v:10.4f}")

    sel = val["selected_candidate_id"]
    print(f"\nSelected candidate (by 3-split validation mean): {sel}")

    print("\n=== 3. Locked Candidate Check Across Seeds (Control 100..124 & 3-Split Val Mean) ===")
    for seed_key, sdata in res["locked_candidate_evaluation"]["seeds"].items():
        c = sdata["control_100_124_pm25"]
        vm = sdata["validation_3split_mean_pm25_clipped"]
        print(
            f"seed={seed_key:>3} | Control 100..124 clipped MAE -> "
            f"pers={c['persistence']['mae_clipped']:.4f}, "
            f"curr={c['current_lgbm']['mae_clipped']:.4f}, "
            f"{sel}={c[sel]['mae_clipped']:.4f} | "
            f"ValMean -> pers={vm['persistence']:.4f}, curr={vm['current_lgbm']:.4f}, {sel}={vm[sel]:.4f}"
        )

    t = res["applicability_and_timing"]
    print("\n=== 4. Timing & SHAP Additivity (seed=42) ===")
    print(
        f"current_lgbm       : train median = {t['current_lgbm']['train_3960_rows_ms']['median']:.2f} ms, "
        f"40-zone batch = {t['current_lgbm']['enrich_batch_40_zones_ms']['median']:.3f} ms, "
        f"SHAP max err = {t['current_lgbm']['shap_max_additivity_error_across_40_zones']:.2e}"
    )
    print(
        f"selected_candidate : train median = {t['selected_candidate']['train_3960_rows_ms']['median']:.2f} ms, "
        f"40-zone batch = {t['selected_candidate']['enrich_batch_40_zones_ms']['median']:.3f} ms, "
        f"SHAP max err = {t['selected_candidate']['shap_max_additivity_error_across_40_zones']:.2e}"
    )
    print(f"\nRecommend replacement: {res['recommendation']['recommend_production_replacement']}")


if __name__ == "__main__":
    results = run_benchmark(write_output=True)
    print_report(results)
