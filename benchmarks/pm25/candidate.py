"""In-memory PM2.5 forecasting candidates and composite SHAP explanation logic.

Does not touch app/ code or data/models.joblib.
"""
from __future__ import annotations

from typing import Any

from lightgbm import LGBMRegressor
import numpy as np
import pandas as pd
import shap

from app.ml.engine import FEATURES, LABELS, feature_row


def clip_pm25(values: np.ndarray | float) -> np.ndarray | float:
    """Apply the physical lower bound used in MLEngine.enrich/explain (PM2.5 >= 0)."""
    if np.ndim(values) == 0:
        return float(max(0.0, float(values)))
    return np.maximum(0.0, np.asarray(values, dtype=float))


def clip_esi(values: np.ndarray | float) -> np.ndarray | float:
    """Apply the scenario bounds used in MLEngine.enrich/explain (0 <= ESI <= 100)."""
    if np.ndim(values) == 0:
        return float(min(100.0, max(0.0, float(values))))
    return np.clip(np.asarray(values, dtype=float), 0.0, 100.0)


def validate_feature_frame(frame: pd.DataFrame) -> None:
    if list(frame.columns) != FEATURES:
        raise ValueError(f"Expected exact FEATURES columns {FEATURES}, got {list(frame.columns)}")
    arr = frame.to_numpy(dtype=float, copy=False)
    if not np.all(np.isfinite(arr)):
        raise ValueError("Feature frame contains NaN or infinite values.")


class BasePM25Forecaster:
    """Common contract for in-memory PM2.5 +3h forecasters."""

    variant_id: str
    kind: str

    def fit(self, x_train: pd.DataFrame, y_train: np.ndarray) -> "BasePM25Forecaster":
        raise NotImplementedError

    def predict_raw(self, x_eval: pd.DataFrame) -> np.ndarray:
        raise NotImplementedError

    def predict_clipped(self, x_eval: pd.DataFrame) -> np.ndarray:
        raw = self.predict_raw(x_eval)
        return np.asarray(clip_pm25(raw), dtype=float)

    def enrich_pm25_batch(self, readings: list[dict[str, Any]], zones_by_id: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
        """Batch prediction compatible with MLEngine.enrich() on a 40-station packet."""
        if not readings:
            return []
        frame = pd.DataFrame(
            [feature_row(r, zones_by_id[r["sensor_id"]]) for r in readings],
            columns=FEATURES,
        )
        raw_preds = self.predict_raw(frame)
        return [
            {
                **reading,
                "predicted_pm25": round(max(0.0, float(raw_preds[i])), 3),
                "prediction_horizon_hours": 3,
                "prediction_kind": "synthetic_model",
            }
            for i, reading in enumerate(readings)
        ]

    def explain_pm25(self, reading: dict[str, Any], zones_by_id: dict[str, dict[str, Any]]) -> dict[str, Any]:
        raise NotImplementedError


class PersistencePM25Forecaster(BasePM25Forecaster):
    """Zero-parameter persistence baseline: pm25(t+3h) = pm25(t)."""

    def __init__(self, variant_id: str = "persistence") -> None:
        self.variant_id = variant_id
        self.kind = "persistence"
        self.train_pm25_mean: float | None = None

    def fit(self, x_train: pd.DataFrame, y_train: np.ndarray) -> "PersistencePM25Forecaster":
        validate_feature_frame(x_train)
        _ = y_train
        self.train_pm25_mean = float(x_train["pm25"].mean())
        return self

    def predict_raw(self, x_eval: pd.DataFrame) -> np.ndarray:
        validate_feature_frame(x_eval)
        return x_eval["pm25"].to_numpy(dtype=float, copy=True)

    def explain_pm25(self, reading: dict[str, Any], zones_by_id: dict[str, dict[str, Any]]) -> dict[str, Any]:
        if self.train_pm25_mean is None:
            raise RuntimeError("Forecaster must be fitted before calling explain_pm25().")
        row = feature_row(reading, zones_by_id[reading["sensor_id"]])
        pm25_idx = FEATURES.index("pm25")
        raw = float(row[pm25_idx])
        displayed = max(0.0, raw)
        contribs = np.zeros(len(FEATURES), dtype=float)
        contribs[pm25_idx] = raw - self.train_pm25_mean
        base = float(self.train_pm25_mean)
        return {
            "sensor_id": reading["sensor_id"],
            "target": "pm25",
            "horizon_hours": 3,
            "units": "µg/m³",
            "base_value": base,
            "prediction_raw": raw,
            "prediction": displayed,
            "clipping_applied": raw != displayed,
            "additivity_error": abs(base + float(contribs.sum()) - raw),
            "features": sorted(
                [
                    {"feature": k, "label": LABELS[k], "value": row[i], "contribution": float(contribs[i])}
                    for i, k in enumerate(FEATURES)
                ],
                key=lambda f: abs(f["contribution"]),
                reverse=True,
            ),
            "note": "Базовый инерционный прогноз PM2.5(t+3ч) = PM2.5(t)",
        }


class DirectLGBMForecaster(BasePM25Forecaster):
    """Direct target LightGBM forecaster (covers current_lgbm and regularized_direct_l1)."""

    def __init__(self, variant_id: str, params: dict[str, Any], seed: int) -> None:
        self.variant_id = variant_id
        self.kind = "direct_lgbm"
        self.params = dict(params)
        self.seed = int(seed)
        self.model: LGBMRegressor | None = None
        self._explainer: shap.TreeExplainer | None = None

    def fit(self, x_train: pd.DataFrame, y_train: np.ndarray) -> "DirectLGBMForecaster":
        validate_feature_frame(x_train)
        target_arr = np.asarray(y_train, dtype=float)
        if len(x_train) != len(target_arr):
            raise ValueError("Mismatched feature and target lengths.")
        self.model = LGBMRegressor(**self.params, random_state=self.seed)
        self.model.fit(x_train, target_arr)
        self._explainer = None
        return self

    @property
    def explainer(self) -> shap.TreeExplainer:
        if self.model is None:
            raise RuntimeError("Model is not fitted.")
        if self._explainer is None:
            self._explainer = shap.TreeExplainer(self.model)
        return self._explainer

    def predict_raw(self, x_eval: pd.DataFrame) -> np.ndarray:
        if self.model is None:
            raise RuntimeError("Model is not fitted.")
        validate_feature_frame(x_eval)
        return np.asarray(self.model.predict(x_eval), dtype=float)

    def explain_pm25(self, reading: dict[str, Any], zones_by_id: dict[str, dict[str, Any]]) -> dict[str, Any]:
        if self.model is None:
            raise RuntimeError("Model is not fitted.")
        row = feature_row(reading, zones_by_id[reading["sensor_id"]])
        frame = pd.DataFrame([row], columns=FEATURES)
        contributions = np.asarray(self.explainer.shap_values(frame), dtype=float)[0]
        base = float(np.asarray(self.explainer.expected_value).reshape(-1)[0])
        raw = float(self.model.predict(frame)[0])
        displayed = max(0.0, raw)
        return {
            "sensor_id": reading["sensor_id"],
            "target": "pm25",
            "horizon_hours": 3,
            "units": "µg/m³",
            "base_value": base,
            "prediction_raw": raw,
            "prediction": displayed,
            "clipping_applied": raw != displayed,
            "additivity_error": abs(base + float(contributions.sum()) - raw),
            "features": sorted(
                [
                    {"feature": k, "label": LABELS[k], "value": row[i], "contribution": float(contributions[i])}
                    for i, k in enumerate(FEATURES)
                ],
                key=lambda f: abs(f["contribution"]),
                reverse=True,
            ),
            "note": "Вклад признаков в прогноз синтетической модели; причинный эффект посадки не оценивается SHAP",
        }


class ResidualLGBMForecaster(BasePM25Forecaster):
    """Increment forecaster: predicts delta = pm25(t+3h) - pm25(t), reconstructs pm25(t) + delta_hat.

    Uses one training-only background B for interventional Tree SHAP and the
    linear current-PM2.5 term. Linearity therefore applies to the same game:
      f(x) = x_pm25 + g(x)
      Phi_0(f) = E_B[X_pm25] + phi_0(g)
      Phi_pm25(f) = (x_pm25 - E_B[X_pm25]) + phi_pm25(g)
      Phi_j(f) = phi_j(g)  for j != pm25
    Hence Phi_0(f) + sum_j Phi_j(f) == x_pm25 + g(x) == prediction_raw identically.
    """

    def __init__(self, variant_id: str, params: dict[str, Any], seed: int) -> None:
        self.variant_id = variant_id
        self.kind = "residual_lgbm"
        self.params = dict(params)
        self.seed = int(seed)
        self.model: LGBMRegressor | None = None
        self.train_pm25_mean: float | None = None
        self.background: pd.DataFrame | None = None
        self._explainer: shap.TreeExplainer | None = None

    def fit(self, x_train: pd.DataFrame, y_train: np.ndarray) -> "ResidualLGBMForecaster":
        validate_feature_frame(x_train)
        target_arr = np.asarray(y_train, dtype=float)
        if len(x_train) != len(target_arr):
            raise ValueError("Mismatched feature and target lengths.")
        pm25_current = x_train["pm25"].to_numpy(dtype=float, copy=False)
        delta_target = target_arr - pm25_current

        # <=100 rows prevents TreeExplainer's default background subsampling.
        # Both terms must use exactly this same empirical background.
        self.background = x_train.sample(n=min(100, len(x_train)), random_state=self.seed).copy(deep=True)
        self.train_pm25_mean = float(self.background["pm25"].mean())
        self.model = LGBMRegressor(**self.params, random_state=self.seed)
        self.model.fit(x_train, delta_target)
        self._explainer = None
        return self

    @property
    def explainer(self) -> shap.TreeExplainer:
        if self.model is None or self.background is None:
            raise RuntimeError("Model is not fitted.")
        if self._explainer is None:
            self._explainer = shap.TreeExplainer(
                self.model, data=self.background, feature_perturbation="interventional"
            )
        return self._explainer

    def predict_delta(self, x_eval: pd.DataFrame) -> np.ndarray:
        if self.model is None:
            raise RuntimeError("Model is not fitted.")
        validate_feature_frame(x_eval)
        return np.asarray(self.model.predict(x_eval), dtype=float)

    def predict_raw(self, x_eval: pd.DataFrame) -> np.ndarray:
        validate_feature_frame(x_eval)
        return x_eval["pm25"].to_numpy(dtype=float, copy=False) + self.predict_delta(x_eval)

    def explain_pm25(self, reading: dict[str, Any], zones_by_id: dict[str, dict[str, Any]]) -> dict[str, Any]:
        if self.model is None or self.train_pm25_mean is None:
            raise RuntimeError("Model is not fitted.")
        row = feature_row(reading, zones_by_id[reading["sensor_id"]])
        frame = pd.DataFrame([row], columns=FEATURES)

        delta_contribs = np.asarray(self.explainer.shap_values(frame), dtype=float)[0]
        delta_base = float(np.asarray(self.explainer.expected_value).reshape(-1)[0])
        delta_raw = float(self.model.predict(frame)[0])

        pm25_idx = FEATURES.index("pm25")
        current_pm25 = float(row[pm25_idx])

        full_base = float(self.train_pm25_mean + delta_base)
        full_contribs = delta_contribs.copy()
        full_contribs[pm25_idx] += current_pm25 - self.train_pm25_mean

        raw = current_pm25 + delta_raw
        displayed = max(0.0, raw)
        return {
            "sensor_id": reading["sensor_id"],
            "target": "pm25",
            "horizon_hours": 3,
            "units": "µg/m³",
            "base_value": full_base,
            "prediction_raw": raw,
            "prediction": displayed,
            "clipping_applied": raw != displayed,
            "additivity_error": abs(full_base + float(full_contribs.sum()) - raw),
            "features": sorted(
                [
                    {"feature": k, "label": LABELS[k], "value": row[i], "contribution": float(full_contribs[i])}
                    for i, k in enumerate(FEATURES)
                ],
                key=lambda f: abs(f["contribution"]),
                reverse=True,
            ),
            "note": "Вклад признаков в полный прогноз PM2.5 = PM2.5(t) + ΔPM2.5 синтетической модели; причинный эффект посадки не оценивается SHAP",
        }


def build_pm25_forecaster(spec: dict[str, Any], seed: int) -> BasePM25Forecaster:
    """Instantiate a forecaster from a protocol.json entry."""
    variant_id = spec["id"]
    kind = spec["kind"]
    if kind == "persistence":
        return PersistencePM25Forecaster(variant_id=variant_id)
    if kind == "direct_lgbm":
        return DirectLGBMForecaster(variant_id=variant_id, params=spec["params"], seed=seed)
    if kind == "residual_lgbm":
        return ResidualLGBMForecaster(variant_id=variant_id, params=spec["params"], seed=seed)
    raise ValueError(f"Unsupported forecaster kind: {kind!r}")
