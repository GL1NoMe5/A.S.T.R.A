from copy import deepcopy
from datetime import timedelta

import numpy as np
import pytest

from app.core.config import Settings
from app.core.zones import distance_m, make_zones
from app.db.session import create_storage
from app.services.background import BackgroundService, utcnow
from app.services.simulator import simulate_reading


def test_reference_sites_are_separated_and_have_coherent_profiles():
    zones = make_zones()
    assert len(zones) == len({z['id'] for z in zones}) == 40
    assert len({z['latitude'] for z in zones}) > 30
    assert all(z['location_source'].startswith('https://www.openstreetmap.org/') for z in zones)
    assert all(set(z['name_i18n']) == {'ru', 'en', 'kk'} for z in zones)
    assert min(distance_m(a, b) for i, a in enumerate(zones) for b in zones[i+1:]) >= 450
    parks = [z for z in zones if z['site_type'] == 'park']
    roads = [z for z in zones if z['site_type'] == 'arterial']
    assert parks and roads
    assert min(z['ndvi'] for z in parks) > max(z['ndvi'] for z in roads)
    assert max(z['traffic_base'] for z in parks) < min(z['traffic_base'] for z in roads)


@pytest.mark.asyncio
async def test_relocated_network_does_not_mix_old_history(tmp_path):
    settings = Settings(data_dir=tmp_path, mode='local', background_enabled=False)
    zones = make_zones()
    store = await create_storage(settings)
    try:
        await store.initialize(zones)
        # Two readings in the same minute exercise aggregate replacement.
        stamp = utcnow().replace(second=10, microsecond=0)
        current = simulate_reading(zones[0], stamp, BackgroundService(settings).snapshot(), np.random.default_rng(42))
        current.update(predicted_pm25=current['pm25'], predicted_esi=current['esi'])
        old = deepcopy(current)
        old.update(network_version='grid-v1', timestamp=(stamp-timedelta(seconds=1)).isoformat(), pm25=999)
        await store.save_batch([old])
        assert await store.history() == []
        assert await store.latest() == []
        await store.save_batch([current])
        for minutes in (60, 1440):
            points = await store.history(minutes=minutes)
            assert len(points) == 1
            assert points[0]['pm25'] == current['pm25']
        assert (await store.latest())[0]['network_version'] == zones[0]['network_version']
    finally:
        await store.close()
