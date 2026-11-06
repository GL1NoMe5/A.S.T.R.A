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
SUMMER_DAY = {"air_temp_c": 28.0, "surface_temp_before": 38.0}
METHODOLOGY = {
    "version": "scenario-v2", "parameter_kind": "illustrative_assumptions_not_astana_calibration",
    "mixing_height_m": 20, "residence_seconds": 3600, "maturity_years": 10,
    "deposition_basis": "F = Vd × C × leaf area; scenario box-model concentration response",
    "sources": ["https://www.itreetools.org/eco/resources/iTree_Eco_Dry_Deposition_Model_Descriptions.pdf",
                "https://research.fs.usda.gov/treesearch/46254",
                "https://doi.org/10.2134/jeq2015.02.0097",
                "https://www.epa.gov/heatislands/benefits-trees-and-vegetation"],
    "note": "Источники обосновывают механизмы; численные коэффициенты пород — сценарные допущения, не измерения Астаны",
    "baseline_kind": "same_sites_same_scenario_no_new_planting",
    "thermal_model": {
        "kind": "area_mean_shade_of_surface_excess", "summer_day": SUMMER_DAY,
        "canopy_extinction": 0.5, "leaf_fraction_temp_range_c": [0, 20],
        "cold_leaf_fraction": {"pine": 0.6, "elm": 0.12, "poplar": 0.12},
    },
    "summary_domain": "area_weighted_planted_sites_only",
    "allocation_policy": {
        "id": "capacity_expansion_v1", "kind": "heuristic_not_universal_ecological_optimum",
        "initial_site_pool": 10, "expand_to_budget": True,
        "marginal_weights": {"pm25_reduction": 1, "cooling_c": 2, "co2_tons_year": 0.1},
        "tradeoff": "Higher heuristic score does not guarantee higher cooling or every individual benefit",
    },
}


def thermal_conditions(reading, thermal_scenario):
    if thermal_scenario == "summer_day":
        return SUMMER_DAY["air_temp_c"], SUMMER_DAY["surface_temp_before"]
    return reading["air_temp_c"], reading["surface_temp_c"]


def ecological_effect(zone, reading, trees, species, years, thermal_scenario="current_weather"):
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
    air_temp, surface_temp = thermal_conditions(reading, thermal_scenario)
    # Intercepted light and extra crown coverage scale the average over the whole site.
    thermal = METHODOLOGY["thermal_model"]
    cold_leaf = thermal["cold_leaf_fraction"][species]
    low, high = thermal["leaf_fraction_temp_range_c"]
    foliage = cold_leaf + (1 - cold_leaf) * min(1.0, max(0.0, (air_temp - low) / (high - low)))
    interception = -math.expm1(-thermal["canopy_extinction"] * p["lai"] * foliage)
    excess = max(0.0, surface_temp - air_temp)
    cooling = canopy / zone["area_m2"] * interception * min(excess, p["cooling_max_c"])
    return {"trees": trees, "surviving_trees": surviving, "canopy_m2": canopy,
            "pm25_before": pm, "pm25_after": pm * (1 - fraction),
            "pm25_reduction": pm * fraction, "pm25_reduction_pct": fraction * 100,
            "thermal_air_temp_c": air_temp, "site_air_temp_c": reading["air_temp_c"],
            "site_surface_temp_c": reading["surface_temp_c"],
            "surface_temp_before": surface_temp, "surface_temp_after": surface_temp - cooling,
            "cooling_c": cooling,
            "co2_tons_year": surviving * p["annual_co2_kg"] * growth / 1000}


def select_sites(request: OptimizeRequest, zones: list[dict], latest: dict):
    """Keep the initial priority pool, expanding it until the budget can fit."""
    candidates = [z for z in zones if (request.target_district == "all" or z["district"] == request.target_district)
                  and z["id"] in latest and z["planting_capacity"] > 0]
    scores = {}
    for z in candidates:
        r = latest[z["id"]]
        _, surface_temp = thermal_conditions(r, request.thermal_scenario)
        heat = max(0, surface_temp - 25)
        scores[z["id"]] = (r["predicted_pm25"] + 2 * heat + r["predicted_esi"] / 5) * (
            1 - z["ndvi"]) * math.sqrt(z["population"] / 1000)
    # A proximity bonus encourages adjacent interventions without pretending to
    # establish a proven aerodynamic corridor.
    selected = []
    selection_context = {}
    remaining = list(candidates)
    selected_capacity = 0
    initial_pool = METHODOLOGY["allocation_policy"]["initial_site_pool"]
    while remaining and (len(selected) < initial_pool or selected_capacity < request.budget_trees):
        def priority(z):
            proximity = max((math.exp(-distance_m(z, s) / 1200) for s in selected), default=0)
            return scores[z["id"]] * (1 + 0.12 * proximity)
        choice = max(remaining, key=lambda z: (priority(z), z["id"]))
        r = latest[choice["id"]]
        selection_context[choice["id"]] = {
            "predicted_pm25": r["predicted_pm25"], "predicted_esi": r["predicted_esi"],
            "heat_above_25_c": max(0, thermal_conditions(r, request.thermal_scenario)[1] - 25),
            "selection_rank": len(selected) + 1,
            "proximity_bonus_pct": 12 * max(
                (math.exp(-distance_m(choice, s) / 1200) for s in selected), default=0),
        }
        selected.append(choice)
        selected_capacity += choice["planting_capacity"]
        remaining.remove(choice)
    return selected, scores, selection_context


def optimize(request: OptimizeRequest, zones: list[dict], latest: dict, background: dict) -> dict:
    selected, scores, selection_context = select_sites(request, zones, latest)
    allocations = {z["id"]: 0 for z in selected}
    # A larger budget can use more than ten sites, up to the eligible catalog.
    for _ in range(request.budget_trees):
        best, best_gain = None, -1.0
        for z in selected:
            n = allocations[z["id"]]
            if n >= z["planting_capacity"]:
                continue
            r = latest[z["id"]]
            a = ecological_effect(z, r, n, request.species, request.horizon_years, request.thermal_scenario)
            b = ecological_effect(z, r, n + 1, request.species, request.horizon_years, request.thermal_scenario)
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
            effect = ecological_effect(z, latest[z["id"]], n, request.species, request.horizon_years,
                                       request.thermal_scenario)
            output.append({**z, **effect, "priority_score": scores[z["id"]],
                           "priority_inputs": selection_context[z["id"]],
                           "population_covered": z["population"]})
    used = sum(z["trees"] for z in output)
    eligible = [z for z in zones if z["id"] in scores]
    unused_reason = None if used == request.budget_trees else (
        "territory_capacity" if eligible else "no_eligible_sites")
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
        "allocation": {"eligible_sites": len(eligible),
                       "eligible_capacity_trees": sum(z["planting_capacity"] for z in eligible),
                       "selected_sites": len(selected),
                       "selected_capacity_trees": sum(z["planting_capacity"] for z in selected),
                       "unused_reason": unused_reason},
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
        "methodology": {**deepcopy(METHODOLOGY), "species_parameters": deepcopy(SPECIES[request.species]),
                        "sensitivity_factors": [0.5, 1.5], "forecast_policy": deepcopy(FORECAST_POLICY)},
        "note": FORECAST_POLICY["note"] + " Загрязнение рассчитывается при исходном погодном фоне. "
                "Для поверхности используется выбранный температурный сценарий. "
                "Зоны, население и коэффициенты сценарные.",
    }
