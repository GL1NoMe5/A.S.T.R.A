"""Transparent scenario calculator, separate from the predictive ML engine."""
from copy import deepcopy
import math
from uuid import uuid4

from app.core.zones import distance_m
from app.ml.engine import FORECAST_POLICY
from app.schemas.telemetry import OptimizeRequest
from app.services.background import utcnow

SPECIES = {
    "elm": {"label": "Вяз", "crown_m2": 25.0, "lai": 3.0, "deposition_m_s": 0.002,
            "survival": 0.85, "annual_co2_kg": 22.0, "cooling_max_c": 4.0},
    "pine": {"label": "Сосна", "crown_m2": 18.0, "lai": 3.5, "deposition_m_s": 0.0025,
             "survival": 0.80, "annual_co2_kg": 18.0, "cooling_max_c": 3.0},
    "poplar": {"label": "Тополь", "crown_m2": 35.0, "lai": 3.0, "deposition_m_s": 0.0018,
               "survival": 0.80, "annual_co2_kg": 28.0, "cooling_max_c": 5.0},
}
METHODOLOGY = {
    "version": "scenario-v1", "parameter_kind": "illustrative_assumptions_not_astana_calibration",
    "mixing_height_m": 20, "residence_seconds": 3600, "maturity_years": 10,
    "deposition_basis": "F = Vd × C × leaf area; scenario box-model concentration response",
    "sources": ["https://www.itreetools.org/eco/resources/iTree_Eco_Dry_Deposition_Model_Descriptions.pdf",
                "https://research.fs.usda.gov/treesearch/46254",
                "https://www.epa.gov/heatislands/benefits-trees-and-vegetation"],
    "note": "Источники обосновывают механизмы; численные коэффициенты пород — сценарные допущения, не измерения Астаны",
}


def ecological_effect(zone, reading, trees, species, years):
    """Dimensionally explicit box model; does not model urban street-canyon CFD."""
    p = SPECIES[species]
    growth = min(1.0, years / 10)
    surviving = trees * p["survival"]
    canopy = min(zone["area_m2"] * (1 - zone["ndvi"]), surviving * p["crown_m2"] * growth)
    # Evergreen activity persists in cold weather; broadleaf activity is reduced.
    season = 1.0 if reading["air_temp_c"] > 10 else (0.6 if species == "pine" else 0.12)
    leaf_area = canopy * p["lai"] * season
    residence = 3600 / (1 + reading["wind_speed"])
    exponent = p["deposition_m_s"] * leaf_area * residence / (zone["area_m2"] * 20)
    fraction = min(0.35, 1 - math.exp(-exponent))
    pm = reading["pm25"]
    shade_fraction = canopy / zone["area_m2"]
    heat_factor = min(1, max(0, (reading["air_temp_c"] - 10) / 20))
    cooling = p["cooling_max_c"] * (1 - math.exp(-3 * shade_fraction)) * heat_factor
    return {"trees": trees, "surviving_trees": surviving, "canopy_m2": canopy,
            "pm25_before": pm, "pm25_after": pm * (1 - fraction),
            "pm25_reduction": pm * fraction, "pm25_reduction_pct": fraction * 100,
            "surface_temp_before": reading["surface_temp_c"],
            "surface_temp_after": reading["surface_temp_c"] - cooling,
            "cooling_c": cooling,
            "co2_tons_year": surviving * p["annual_co2_kg"] * growth / 1000}


def optimize(request: OptimizeRequest, zones: list[dict], latest: dict, background: dict) -> dict:
    candidates = [z for z in zones if (request.target_district == "all" or z["district"] == request.target_district)
                  and z["id"] in latest and z["planting_capacity"] > 0]
    scores = {}
    for z in candidates:
        r = latest[z["id"]]
        heat = max(0, r["surface_temp_c"] - 25)
        scores[z["id"]] = (r["predicted_pm25"] + 2 * heat + r["predicted_esi"] / 5) * (
            1 - z["ndvi"]) * math.sqrt(z["population"] / 1000)
    # A proximity bonus encourages adjacent interventions without pretending to
    # establish a proven aerodynamic corridor.
    selected = []
    remaining = list(candidates)
    while remaining and len(selected) < 10:
        def priority(z):
            proximity = max((math.exp(-distance_m(z, s) / 1200) for s in selected), default=0)
            return scores[z["id"]] * (1 + 0.12 * proximity)
        choice = max(remaining, key=lambda z: (priority(z), z["id"]))
        selected.append(choice)
        remaining.remove(choice)
    allocations = {z["id"]: 0 for z in selected}
    # Single-tree marginal allocation is bounded at 10,000 × 10 evaluations.
    for _ in range(request.budget_trees):
        best, best_gain = None, -1.0
        for z in selected:
            n = allocations[z["id"]]
            if n >= z["planting_capacity"]:
                continue
            r = latest[z["id"]]
            a = ecological_effect(z, r, n, request.species, request.horizon_years)
            b = ecological_effect(z, r, n + 1, request.species, request.horizon_years)
            gain = (b["pm25_reduction"] - a["pm25_reduction"] +
                    2 * (b["cooling_c"] - a["cooling_c"]) +
                    0.1 * (b["co2_tons_year"] - a["co2_tons_year"])) * scores[z["id"]]
            if gain > best_gain:
                best, best_gain = z, gain
        if best is None:
            break
        allocations[best["id"]] += 1
    output = []
    for z in selected:
        n = allocations[z["id"]]
        if n:
            effect = ecological_effect(z, latest[z["id"]], n, request.species, request.horizon_years)
            output.append({**z, **effect, "priority_score": scores[z["id"]],
                           "population_covered": z["population"]})
    used = sum(z["trees"] for z in output)
    population = sum(z["population_covered"] for z in output)
    weight = sum(z["area_m2"] for z in output)
    avg = lambda key: sum(z[key] * z["area_m2"] for z in output) / weight if weight else 0
    reduction, cooling, co2 = avg("pm25_reduction"), avg("cooling_c"), sum(z["co2_tons_year"] for z in output)
    planting = used * (request.sapling_cost_kzt + request.planting_cost_kzt)
    yearly_care = used * request.annual_care_cost_kzt
    first_year = planting + yearly_care + request.pilot_equipment_cost_kzt + request.annual_platform_cost_kzt
    return {
        "run_id": str(uuid4()), "created_at": utcnow().isoformat(), "request": request.model_dump(),
        "zones": output, "used_trees": used, "unused_trees": request.budget_trees - used,
        "horizon_years": request.horizon_years, "background": deepcopy(background),
        "summary": {"pm25_before": avg("pm25_before"), "pm25_after": avg("pm25_after"),
                    "pm25_reduction": reduction,
                    "pm25_reduction_pct": 100 * reduction / avg("pm25_before") if avg("pm25_before") else 0,
                    "surface_temp_before": avg("surface_temp_before"), "surface_temp_after": avg("surface_temp_after"),
                    "cooling_c": cooling, "co2_tons_year": co2,
                    "population_covered": population, "population_kind": "scenario_disjoint_cells",
                    "range_kind": "sensitivity_band_not_confidence_interval",
                    "pm25_reduction_range": [reduction * 0.5, reduction * 1.5],
                    "cooling_c_range": [cooling * 0.5, cooling * 1.5],
                    "co2_tons_year_range": [co2 * 0.5, co2 * 1.5]},
        "costs": {"currency": "KZT", "kind": "editable_scenario_assumptions", "planting": planting,
                  "annual_care": yearly_care, "equipment": request.pilot_equipment_cost_kzt,
                  "annual_platform": request.annual_platform_cost_kzt, "first_year_total": first_year,
                  "horizon_total": planting + request.pilot_equipment_cost_kzt + request.horizon_years * (
                      yearly_care + request.annual_platform_cost_kzt)},
        "methodology": {**deepcopy(METHODOLOGY), "species_parameters": SPECIES[request.species],
                        "sensitivity_factors": [0.5, 1.5], "forecast_policy": deepcopy(FORECAST_POLICY)},
        "note": FORECAST_POLICY["note"] + " Эффект через заданное число лет при текущем погодном фоне; "
                "зоны, население и коэффициенты сценарные.",
    }
