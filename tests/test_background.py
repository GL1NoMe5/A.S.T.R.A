from datetime import timedelta
import json
from pathlib import Path

import httpx
import pytest

from app.core.config import Settings
from app.services.background import BackgroundService, DEFAULTS, FIELDS, UNITS, utcnow


def response_body(part):
    return {
        "latitude": 51.2, "longitude": 71.4,
        "current": {"time": "2026-10-25T09:00", "interval": 3600 if part == "air" else 900,
                    **{field: (35 if key == "european_aqi" else DEFAULTS[part][key])
                       for key, field in FIELDS[part].items()}},
        "current_units": {field: UNITS[key] for key, field in FIELDS[part].items()},
    }


async def test_success_cache_restart_and_partial_outage(tmp_path):
    failing = set()
    seen = []

    def transport(request):
        part = "air" if "air-quality" in str(request.url) else "weather"
        seen.append(request.url)
        if part in failing:
            return httpx.Response(503)
        return httpx.Response(200, json=response_body(part))

    settings = Settings(data_dir=tmp_path)
    async with httpx.AsyncClient(transport=httpx.MockTransport(transport)) as client:
        service = BackgroundService(settings, client)
        await service.refresh()
        snapshot = service.snapshot()
        assert snapshot["air"]["status"] == "live"
        assert snapshot["weather"]["values"]["wind_speed"] == 3
        assert snapshot["air"]["source_time"].endswith("+00:00")
        assert any(url.params.get("wind_speed_unit") == "ms" for url in seen)
        old_source_time = snapshot["air"]["source_time"]
        failing.add("air")
        await service.refresh()
        snapshot = service.snapshot()
        assert snapshot["air"]["status"] == "cached"
        assert snapshot["air"]["source_time"] == old_source_time
        assert snapshot["weather"]["status"] == "live"
        restarted = BackgroundService(settings, client)
        assert restarted.snapshot()["air"]["status"] == "cached"
        failing.add("weather")
        await restarted.refresh()
        assert all(restarted.snapshot()[p]["status"] == "cached" for p in FIELDS)
        for block in restarted.cache.values():
            block["fetched_at"] = (utcnow() - timedelta(hours=25)).isoformat()
        expired = restarted.snapshot()
        assert all(expired[p]["status"] == "default" for p in FIELDS)
        assert expired["air"]["values"]["european_aqi"] is None


@pytest.mark.parametrize("failure", ["timeout", "null", "wrong_unit", "invalid_json", "http429"])
async def test_invalid_sources_remain_explicit_defaults(tmp_path, failure):
    def transport(request):
        if failure == "timeout":
            raise httpx.ReadTimeout("test timeout", request=request)
        if failure == "invalid_json":
            return httpx.Response(200, content=b"{broken")
        if failure == "http429":
            return httpx.Response(429)
        part = "air" if "air-quality" in str(request.url) else "weather"
        body = response_body(part)
        if failure == "null":
            body["current"][next(iter(FIELDS[part].values()))] = None
        else:
            body["current_units"] = {key: "wrong" for key in body["current_units"]}
        return httpx.Response(200, json=body)

    async with httpx.AsyncClient(transport=httpx.MockTransport(transport)) as client:
        service = BackgroundService(Settings(data_dir=tmp_path), client)
        await service.refresh()
        assert all(service.snapshot()[p]["status"] == "default" for p in FIELDS)


def test_corrupt_cache_does_not_stop_startup(tmp_path):
    (tmp_path / "background-cache.json").write_text("broken", encoding="utf-8")
    service = BackgroundService(Settings(data_dir=tmp_path, background_enabled=False))
    assert service.snapshot()["air"]["status"] == "default"


async def test_disabled_network_never_calls_transport(tmp_path):
    def transport(request):
        raise AssertionError("Network must stay disabled")
    async with httpx.AsyncClient(transport=httpx.MockTransport(transport)) as client:
        service = BackgroundService(Settings(data_dir=tmp_path, background_enabled=False), client)
        await service.refresh()
        assert service.snapshot()["weather"]["status"] == "default"


@pytest.mark.parametrize("blocked_attempts", [1, 4])
async def test_cache_replace_retries_transient_lock_but_preserves_permanent_error(
        tmp_path, monkeypatch, blocked_attempts):
    service = BackgroundService(Settings(data_dir=tmp_path, background_enabled=False))
    service.cache = {"previous": "snapshot"}
    await service._persist_cache()
    previous = service.path.read_text(encoding="utf-8")
    service.cache = {"updated": "snapshot"}
    original_replace = Path.replace
    attempts = 0

    def replace(path, target):
        nonlocal attempts
        attempts += 1
        if attempts <= blocked_attempts:
            raise PermissionError(13, "Temporary Windows file lock")
        return original_replace(path, target)

    monkeypatch.setattr(Path, "replace", replace)
    if blocked_attempts == 4:
        with pytest.raises(PermissionError):
            await service._persist_cache()
        assert attempts == 4
        assert service.path.read_text(encoding="utf-8") == previous
    else:
        await service._persist_cache()
        assert attempts == 2
        assert json.loads(service.path.read_text(encoding="utf-8"))["updated"] == "snapshot"
    assert not list(tmp_path.glob("*.tmp"))
