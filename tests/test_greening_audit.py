from copy import deepcopy
import pytest

from app.ml.optimizer import SPECIES, ecological_effect, optimize, select_sites
from app.schemas.telemetry import OptimizeRequest
from benchmarks.greening.benchmark import equal_allocation, evaluate, fixture


def test_equal_baseline_redistributes_capacity_and_keeps_fixed_domain(zones):
    sites = deepcopy(zones[:2])
    sites[0]['planting_capacity'] = 1
    sites[1]['planting_capacity'] = 100
    assert equal_allocation(sites, 100) == {sites[0]['id']: 1, sites[1]['id']: 99}
    assert sum(equal_allocation(sites, 200).values()) == 101
    assert equal_allocation([], 100) == {}
    req = OptimizeRequest(budget_trees=100)
    readings = fixture(sites, 28, 1)
    metrics = evaluate(sites, readings, {sites[0]['id']: 1}, req)
    effect = ecological_effect(sites[0], readings[sites[0]['id']], 1, 'elm', 10)
    assert metrics['pm25_reduction_area_mean'] == pytest.approx(
        effect['pm25_reduction'] * sites[0]['area_m2'] / sum(z['area_m2'] for z in sites))


def test_greedy_allocation_matches_exhaustive_small_case(zones):
    sites = deepcopy(zones[:2])
    for z in sites:
        z['planting_capacity'] = 100
    request = OptimizeRequest(budget_trees=100)
    readings = fixture(sites, 28, 1)
    original = deepcopy(readings)
    result = optimize(request, sites, readings, {})
    allocation = {z['id']: z['trees'] for z in result['zones']}
    brute = max(evaluate(sites, readings, {sites[0]['id']: n, sites[1]['id']: 100-n}, request)
                ['heuristic_objective'] for n in range(101))
    assert evaluate(sites, readings, allocation, request)['heuristic_objective'] == pytest.approx(brute)
    assert readings == original
    selected, _, _ = select_sites(request, sites, readings)
    assert len(selected) == 2
    result['methodology']['species_parameters']['survival'] = 0
    assert SPECIES['elm']['survival'] == .85
