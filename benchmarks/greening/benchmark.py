"""Offline model audit, not field validation. Run from any working directory."""
from copy import deepcopy
from hashlib import sha256
from itertools import product
import json
from pathlib import Path
import sys
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from app.core.zones import make_zones
from app.ml.optimizer import SPECIES, ecological_effect, optimize, select_sites
from app.schemas.telemetry import OptimizeRequest
from app.services.simulator import stress_index


def equal_allocation(sites, budget):
    """Round-robin equal shares, redistribute overflow, no capacity violation."""
    sites = sorted(sites, key=lambda z: z['id'])
    allocation = {z['id']: 0 for z in sites}
    while budget:
        active = [z for z in sites if allocation[z['id']] < z['planting_capacity']]
        if not active:
            break
        for z in active:
            if not budget:
                break
            allocation[z['id']] += 1
            budget -= 1
    return allocation


def fixture(zones, air_temp, wind):
    # Explicit synthetic contrasts; no external readings or learned forecasts.
    readings = {}
    for z in zones:
        pm = 15 + 35 * z['traffic_base'] + 5 * z['density']
        surface = air_temp + 8 * z['density'] - 3 * z['ndvi']
        readings[z['id']] = dict(pm25=pm, predicted_pm25=pm,
            predicted_esi=stress_index(pm, 25, surface), surface_temp_c=surface,
            air_temp_c=air_temp, wind_speed=wind)
    return readings


def evaluate(zones, readings, allocation, request):
    """Always use all eligible zones in the denominator, including zero planting."""
    area = sum(z['area_m2'] for z in zones)
    population = sum(z['population'] for z in zones)
    _, scores, _ = select_sites(request, zones, readings)
    pm = cooling = co2 = objective = exposure = 0.0
    for z in zones:
        effect = ecological_effect(z, readings[z['id']], allocation.get(z['id'], 0),
                                   request.species, request.horizon_years)
        pm += effect['pm25_reduction'] * z['area_m2']
        cooling += effect['cooling_c'] * z['area_m2']
        co2 += effect['co2_tons_year']
        exposure += effect['pm25_reduction'] * z['population']
        objective += scores.get(z['id'], 0) * (effect['pm25_reduction'] +
                     2 * effect['cooling_c'] + .1 * effect['co2_tons_year'])
    return dict(used_trees=sum(allocation.values()),
                pm25_reduction_area_mean=pm / area if area else 0,
                cooling_c_area_mean=cooling / area if area else 0,
                pm25_reduction_population_mean=exposure / population if population else 0,
                co2_tons_year=co2, heuristic_objective=objective)


def run():
    zones = make_zones()
    cases = []
    weather = [('cold', -5, 4), ('warm_calm', 28, 1), ('hot_windy', 35, 7)]
    for (label, temp, wind), species, budget, years in product(
            weather, SPECIES, [100, 1000], [1, 10]):
        request = OptimizeRequest(species=species, budget_trees=budget, horizon_years=years)
        readings = fixture(zones, temp, wind)
        selected, _, _ = select_sites(request, zones, readings)
        result = optimize(request, zones, readings, {})
        allocation = {z['id']: z['trees'] for z in result['zones']}
        # Primary comparator shares both the 10-site constraint and exact sites.
        equal = equal_allocation(selected, budget)
        # Secondary reference deliberately relaxes the 10-site constraint.
        uniform_city = equal_allocation(zones, budget)
        cases.append(dict(weather=label, species=species, budget=budget, years=years,
            eligible_ids=[z['id'] for z in zones], selected_ids=[z['id'] for z in selected],
            astra=evaluate(zones, readings, allocation, request),
            equal_same_sites=evaluate(zones, readings, equal, request),
            equal_all_sites=evaluate(zones, readings, uniform_city, request),
            allocations=dict(astra=allocation, equal_same_sites=equal, equal_all_sites=uniform_city)))
    # One-at-a-time coefficient changes, followed by a fresh allocation.
    request = OptimizeRequest(species='elm', budget_trees=1000, horizon_years=10)
    readings = fixture(zones, 28, 1)
    params = deepcopy(SPECIES['elm'])
    sensitivity = []
    for parameter, factor in product(
            ['survival', 'crown_m2', 'lai', 'deposition_m_s', 'annual_co2_kg', 'cooling_max_c'], [.8, 1.2]):
        changed = {**params, parameter: params[parameter] * factor}
        if parameter == 'survival':
            changed[parameter] = min(1.0, changed[parameter])
        with patch.dict(SPECIES, {'elm': changed}):
            result = optimize(request, zones, readings, {})
            allocation = {z['id']: z['trees'] for z in result['zones']}
            sensitivity.append(dict(parameter=parameter, requested_factor=factor,
                applied_value=changed[parameter], actual_factor=changed[parameter] / params[parameter],
                metrics=evaluate(zones, readings, allocation, request), allocation=allocation))
    assert SPECIES['elm'] == params
    keys = ['heuristic_objective', 'pm25_reduction_area_mean', 'cooling_c_area_mean', 'co2_tons_year']
    def tally(reference):
        return {key: {comparison: sum(1 for c in cases if
                (c['astra'][key] - c[reference][key] > 1e-9 if comparison == 'better' else
                 c['astra'][key] - c[reference][key] < -1e-9 if comparison == 'worse' else
                 abs(c['astra'][key] - c[reference][key]) <= 1e-9))
                for comparison in ['better', 'equal', 'worse']} for key in keys}
    files = ['app/ml/optimizer.py', 'app/core/zones.py', 'app/core/pilot_sites.json',
             'app/schemas/telemetry.py', 'app/services/simulator.py', 'benchmarks/greening/benchmark.py']
    return dict(protocol='greening-audit-v1', data_kind='synthetic_fixed_scenarios',
        forecast_kind='fixed_pm25_and_esi_inputs_not_ml_validation',
        primary_comparator='equal allocation on the same selected sites with capacity limits',
        secondary_comparator='equal allocation across all 40 sites; relaxed site-count constraint',
        averaging_domain='all eligible zones; zero planting included',
        source_sha256={p: sha256((ROOT / p).read_bytes()).hexdigest() for p in files},
        totals={ref: tally(ref) for ref in ['equal_same_sites', 'equal_all_sites']},
        cases=cases, sensitivity=sensitivity)


if __name__ == '__main__':
    output = run()
    target = Path(__file__).with_name('results.json')
    target.write_text(json.dumps(output, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'cases': len(output['cases']), 'sensitivity_runs': len(output['sensitivity']),
                      'totals': output['totals'], 'output': str(target)}, ensure_ascii=False))
