from datetime import UTC, datetime, timedelta
import hashlib
import json
from pathlib import Path
import pickle
import time

import joblib
from lightgbm import LGBMRegressor
import numpy as np
import pandas as pd
import shap
from sklearn.metrics import mean_absolute_error

from app.services.simulator import simulate_reading

FEATURES = ["pm25", "pm10", "no2", "air_temp_c", "surface_temp_c", "humidity",
            "wind_speed", "traffic_index", "density", "ndvi", "hour_sin", "hour_cos"]
LABELS = {"pm25": "Текущие PM2.5", "pm10": "Текущие PM10", "no2": "Диоксид азота",
          "air_temp_c": "Температура воздуха", "surface_temp_c": "Температура поверхности",
          "humidity": "Влажность", "wind_speed": "Ветер", "traffic_index": "Трафик",
          "density": "Плотность застройки", "ndvi": "Условный NDVI",
          "hour_sin": "Время суток (sin)", "hour_cos": "Время суток (cos)"}
MODEL_VERSION = "astra-synthetic-v3"
PREDICTION_METHODS = {"pm25": "persistence", "pm25_ml": "lightgbm", "esi": "lightgbm"}
FORECAST_POLICY = {
    "horizon_hours": 3,
    "primary": {"pm25": "persistence", "esi": "lightgbm"},
    "experimental": {"pm25": "lightgbm"},
    "data_kind": "synthetic",
    "note": "PM2.5: сохранение текущего значения; ML доступен для сравнения. ESI: LightGBM. "
            "Выбор основан на синтетической проверке; точность для реальной Астаны не установлена.",
}


def feature_row(reading: dict, zone: dict) -> list[float]:
    timestamp = datetime.fromisoformat(reading["timestamp"])
    hour = (timestamp.hour + timestamp.minute / 60 + 5) % 24
    values = {**reading, **{k: zone[k] for k in ("density", "ndvi")},
              "hour_sin": np.sin(2 * np.pi * hour / 24), "hour_cos": np.cos(2 * np.pi * hour / 24)}
    return [float(values[key]) for key in FEATURES]


def training_data(zones: list[dict], seed=42):
    rng = np.random.default_rng(seed)
    start = datetime(2026, 1, 1, tzinfo=UTC)
    rows, targets, persistence, steps = [], [], [], []
    # A synthetic trajectory spanning several weather regimes; no API response
    # is misrepresented as an observed historical time series.
    readings = []
    for step in range(126):
        phase = step / 16
        pm25 = 35 + 25 * np.sin(phase) + 12 * np.cos(step / 7)
        temp = 8 + 23 * np.sin(step / 23)
        bg = {
            "air": {"values": {"pm25": max(3, pm25), "pm10": max(6, pm25 * 1.5),
                                "no2": 25 + 15 * np.cos(step / 15), "co": 280},
                    "status": "default", "source_time": None},
            "weather": {"values": {"air_temp_c": temp, "humidity": 55 + 25 * np.cos(step / 14),
                                    "wind_speed": 4 + 3 * np.sin(step / 8), "wind_direction": 240},
                        "status": "default", "source_time": None},
        }
        stamp = start + timedelta(hours=step * 3)
        readings.append([simulate_reading(z, stamp, bg, rng) for z in zones])
    for step in range(125):
        for i, zone in enumerate(zones):
            current, future = readings[step][i], readings[step + 1][i]
            rows.append(feature_row(current, zone))
            targets.append([future["pm25"], future["esi"]])
            persistence.append([current["pm25"], current["esi"]])
            steps.append(step)
    return pd.DataFrame(rows, columns=FEATURES), np.array(targets), np.array(persistence), np.array(steps)


class MLEngine:
    def __init__(self, data_dir: Path, zones: list[dict], seed=42):
        self.path = data_dir / "models.joblib"
        self.zones = {z["id"]: z for z in zones}
        self.seed = seed
        self.signature = hashlib.sha256(json.dumps(
            {"version": MODEL_VERSION, "seed": seed, "features": FEATURES, "zones": zones},
            sort_keys=True).encode()).hexdigest()
        self.models = {}
        self.explainers = {}
        self.metrics = {}

    def initialize(self):
        # Only load artifacts created in this local application's data directory.
        # Never load externally supplied pickle/joblib files.
        if self.path.exists():
            try:
                artifact = joblib.load(self.path)
                if artifact["signature"] == self.signature:
                    self.models, self.metrics = artifact["models"], artifact["metrics"]
            except (OSError, ValueError, KeyError, EOFError, pickle.UnpicklingError, AttributeError, ImportError, IndexError):
                self.models = {}
        if not self.models:
            self.train()
        self.explainers = {target: shap.TreeExplainer(model) for target, model in self.models.items()}
        return self.metrics

    def train(self):
        data, targets, baseline, steps = training_data(list(self.zones.values()), self.seed)
        train_mask, test_mask = steps < 99, steps >= 100
        started = time.perf_counter()
        results = {}
        for i, target in enumerate(("pm25", "esi")):
            model = LGBMRegressor(n_estimators=100, num_leaves=15, max_depth=5,
                                  learning_rate=0.07, reg_lambda=1, n_jobs=2,
                                  random_state=self.seed, verbosity=-1)
            model.fit(data[train_mask], targets[train_mask, i])
            raw = model.predict(data[test_mask])
            clipped = np.maximum(0, raw) if target == "pm25" else np.clip(raw, 0, 100)
            reference = baseline[test_mask, i]
            primary = reference if target == "pm25" else clipped
            results[target] = {
                "primary_method": PREDICTION_METHODS[target],
                "mae": float(mean_absolute_error(targets[test_mask, i], primary)),
                "ml_mae": float(mean_absolute_error(targets[test_mask, i], clipped)),
                "ml_mae_raw": float(mean_absolute_error(targets[test_mask, i], raw)),
                "persistence_mae": float(mean_absolute_error(targets[test_mask, i], reference)),
            }
            self.models[target] = model
        self.metrics = {
            "model_version": MODEL_VERSION, "data_kind": "synthetic", "rows": len(data),
            "train_rows": int(train_mask.sum()), "test_rows": int(test_mask.sum()),
            "gap_hours": 3, "horizon_hours": 3, "seed": self.seed,
            "training_seconds": round(time.perf_counter() - started, 4),
            "train_last_feature_step": 98, "train_last_target_step": 99,
            "test_first_feature_step": 100, "targets": results,
            "forecast_policy": FORECAST_POLICY,
            "control_is_independent_holdout": False,
            "note": "Качество на известном синтетическом контрольном отрезке 100–124; "
                    "это не новый независимый контроль. Реальная Астана не валидирована.",
        }
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temp = self.path.with_suffix(".tmp")
        joblib.dump({"signature": self.signature, "models": self.models, "metrics": self.metrics}, temp)
        temp.replace(self.path)

    def enrich(self, readings: list[dict]) -> list[dict]:
        if not readings:
            return []
        frame = pd.DataFrame([feature_row(r, self.zones[r["sensor_id"]]) for r in readings], columns=FEATURES)
        predictions = {key: model.predict(frame) for key, model in self.models.items()}
        return [{**reading, "predicted_pm25": round(max(0, float(reading["pm25"])), 3),
                 "predicted_pm25_ml": round(max(0, float(predictions["pm25"][i])), 3),
                 "predicted_esi": round(min(100, max(0, float(predictions["esi"][i]))), 3),
                 "prediction_horizon_hours": 3, "prediction_kind": "mixed_forecast",
                 "prediction_methods": PREDICTION_METHODS.copy(), "model_version": MODEL_VERSION}
                for i, reading in enumerate(readings)]

    def explain(self, reading: dict, target: str, method: str = "primary"):
        if target not in ("pm25", "esi") or method not in ("primary", "ml"):
            raise ValueError("Unknown forecast target or method")
        if target == "pm25" and method == "primary":
            raw = float(reading["pm25"])
            return {
                "sensor_id": reading["sensor_id"], "timestamp": reading["timestamp"],
                "target": target, "horizon_hours": 3, "units": "µg/m³",
                "explanation_kind": "persistence_rule", "forecast_method": "persistence",
                "forecast_role": "primary", "base_value": 0.0,
                "prediction_raw": raw, "prediction": max(0, raw),
                "clipping_applied": raw < 0, "additivity_error": 0.0,
                "features": [{"feature": "pm25", "label": LABELS["pm25"],
                              "value": raw, "contribution": raw}],
                "note": "Основной прогноз PM2.5 через 3 часа равен текущему значению. "
                        "Это правило сохранения значения, а не SHAP-объяснение ML.",
            }
        row = feature_row(reading, self.zones[reading["sensor_id"]])
        frame = pd.DataFrame([row], columns=FEATURES)
        explainer = self.explainers[target]
        contributions = np.asarray(explainer.shap_values(frame))[0]
        base = float(np.asarray(explainer.expected_value).reshape(-1)[0])
        raw = float(self.models[target].predict(frame)[0])
        displayed = max(0, raw) if target == "pm25" else min(100, max(0, raw))
        return {
            "sensor_id": reading["sensor_id"], "timestamp": reading["timestamp"],
            "target": target, "horizon_hours": 3,
            "explanation_kind": "tree_shap", "forecast_method": "lightgbm",
            "forecast_role": "experimental" if target == "pm25" else "primary",
            "units": "µg/m³" if target == "pm25" else "ESI",
            "base_value": base, "prediction_raw": raw, "prediction": displayed,
            "clipping_applied": raw != displayed,
            "additivity_error": abs(base + float(contributions.sum()) - raw),
            "features": sorted([{"feature": k, "label": LABELS[k], "value": row[i],
                                  "contribution": float(contributions[i])}
                                 for i, k in enumerate(FEATURES)],
                                key=lambda f: abs(f["contribution"]), reverse=True),
            "note": "Вклад признаков в прогноз синтетической модели; причинный эффект посадки не оценивается SHAP",
        }
