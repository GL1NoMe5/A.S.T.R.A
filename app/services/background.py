"""One cached city-scale model background, never presented as station measurements."""
import asyncio
from copy import deepcopy
from datetime import UTC, datetime, timedelta
from email.utils import parsedate_to_datetime
import json
import logging
import math
from uuid import uuid4

import httpx

from app.core.config import Settings

log = logging.getLogger(__name__)
AIR_URL = "https://air-quality-api.open-meteo.com/v1/air-quality"
WEATHER_URL = "https://api.open-meteo.com/v1/forecast"
MET_URL = "https://api.met.no/weatherapi/locationforecast/2.0/compact"
MET_ATTRIBUTION = "https://api.met.no/doc/License"
FIELDS = {
    "air": {"pm10": "pm10", "pm25": "pm2_5", "no2": "nitrogen_dioxide",
            "co": "carbon_monoxide", "european_aqi": "european_aqi"},
    "weather": {"air_temp_c": "temperature_2m", "humidity": "relative_humidity_2m",
                "wind_speed": "wind_speed_10m", "wind_direction": "wind_direction_10m"},
}
DEFAULTS = {
    "air": {"pm25": 20.0, "pm10": 32.0, "no2": 25.0, "co": 250.0, "european_aqi": None},
    "weather": {"air_temp_c": 8.0, "humidity": 65.0, "wind_speed": 3.0, "wind_direction": 240.0},
}
UNITS = {"pm25": "µg/m³", "pm10": "µg/m³", "no2": "µg/m³", "co": "µg/m³",
         "european_aqi": "index", "air_temp_c": "°C", "humidity": "%",
         "wind_speed": "m/s", "wind_direction": "°"}


def utcnow() -> datetime:
    return datetime.now(UTC)


def parse_time(value: str) -> datetime:
    result = datetime.fromisoformat(value.replace("Z", "+00:00"))
    return result.replace(tzinfo=UTC) if result.tzinfo is None else result.astimezone(UTC)


class BackgroundService:
    def __init__(self, settings: Settings, client: httpx.AsyncClient | None = None):
        self.settings = settings
        self.path = settings.data_dir / "background-cache.json"
        self.client = client
        self.cache: dict = {}
        self.errors: dict = {}
        self.loaded = set()
        self.met_data = None
        self.met_expires = datetime.min.replace(tzinfo=UTC)
        self.met_last_modified = None
        self.met_fetched_at = None
        try:
            value = json.loads(self.path.read_text(encoding="utf-8"))
            if value.get("version") == 1:
                for part in FIELDS:
                    block = value.get(part)
                    if block:
                        self._validate_values(part, block["values"])
                        parse_time(block["fetched_at"])
                        parse_time(block["source_time"])
                        self.cache[part] = block
                        self.loaded.add(part)
        except (OSError, ValueError, TypeError, KeyError):
            log.info("No usable background cache; using labelled scenario defaults")

    @staticmethod
    def _validate_values(part: str, values: dict):
        for key in FIELDS[part]:
            v = values[key]
            if not isinstance(v, (int, float)) or not math.isfinite(v):
                raise ValueError(f"Invalid {key}")
            if key != "air_temp_c" and v < 0:
                raise ValueError(f"Negative {key}")
        if part == "weather" and (not -100 <= values["air_temp_c"] <= 65
                                  or values["humidity"] > 100
                                  or values["wind_speed"] > 150
                                  or values["wind_direction"] > 360):
            raise ValueError("Weather outside physical bounds")

    async def refresh(self):
        if not self.settings.background_enabled:
            return
        owned = self.client is None
        client = self.client or httpx.AsyncClient(timeout=self.settings.http_timeout_seconds)

        async def fetch(part: str):
            params = {"latitude": 51.1694, "longitude": 71.4491,
                      "current": ",".join(FIELDS[part].values()), "timezone": "GMT"}
            if part == "weather":
                params["wind_speed_unit"] = "ms"
            try:
                r = await client.get(AIR_URL if part == "air" else WEATHER_URL, params=params)
                r.raise_for_status()
                body = r.json()
                current = body["current"]
                values = {key: current[field] for key, field in FIELDS[part].items()}
                self._validate_values(part, values)
                units = body["current_units"]
                if part == "weather" and units.get("wind_speed_10m") != "m/s":
                    raise ValueError("Unexpected wind speed unit")
                if part == "air" and any(units.get(v) not in ("μg/m³", "µg/m³")
                                         for k, v in FIELDS[part].items() if k != "european_aqi"):
                    raise ValueError("Unexpected pollutant unit")
                self.cache[part] = {
                    "values": values, "source_time": parse_time(current["time"]).isoformat(),
                    "fetched_at": utcnow().isoformat(), "interval_seconds": current.get("interval"),
                    "grid_latitude": body.get("latitude"), "grid_longitude": body.get("longitude"),
                    "provider": "Open-Meteo / CAMS" if part == "air" else "Open-Meteo",
                    "attribution_url": "https://open-meteo.com/",
                }
                self.errors.pop(part, None)
                self.loaded.discard(part)
            except (httpx.HTTPError, ValueError, KeyError, TypeError) as exc:
                error = (f"HTTP {exc.response.status_code}" if isinstance(exc, httpx.HTTPStatusError)
                         else type(exc).__name__)
                if part == "weather":
                    try:
                        self.cache[part] = await self._met_weather(client)
                        self.cache[part]["primary_error"] = error
                        self.errors.pop(part, None)
                        self.loaded.discard(part)
                        return
                    except (httpx.HTTPError, ValueError, KeyError, TypeError, IndexError) as fallback_error:
                        log.warning("MET Norway unavailable (%s); keeping cache", type(fallback_error).__name__)
                self.errors[part] = error
                log.warning("Open-Meteo %s unavailable (%s); keeping cache", part, error)
        try:
            await asyncio.gather(*(fetch(part) for part in FIELDS))
            await self._persist_cache()
        finally:
            if owned:
                await client.aclose()

    async def _met_weather(self, client):
        """A separately attributed forecast fallback; honor MET cache headers."""
        now = utcnow()
        if self.met_data is None or now >= self.met_expires:
            headers = {"User-Agent": "ASTRA/1.0 https://github.com/GL1NoMe5/A.S.T.R.A"}
            if self.met_last_modified:
                headers["If-Modified-Since"] = self.met_last_modified
            response = await client.get(MET_URL, params={"lat": "51.1694", "lon": "71.4491"},
                                        headers=headers)
            if response.status_code != 304:
                response.raise_for_status()
                self.met_data = response.json()["properties"]
                self.met_last_modified = response.headers.get("last-modified")
            if self.met_data is None:
                raise ValueError("MET returned no forecast")
            self.met_fetched_at = now.isoformat()
            expires = response.headers.get("expires")
            self.met_expires = (parsedate_to_datetime(expires).astimezone(UTC) if expires
                                else now + timedelta(minutes=30))
        units = self.met_data["meta"]["units"]
        fields = {"air_temp_c": "air_temperature", "humidity": "relative_humidity",
                  "wind_speed": "wind_speed", "wind_direction": "wind_from_direction"}
        expected_units = {"air_temperature": "celsius", "relative_humidity": "%",
                          "wind_speed": "m/s", "wind_from_direction": "degrees"}
        if any(units.get(key) != value for key, value in expected_units.items()):
            raise ValueError("Unexpected MET units")
        row = min(self.met_data["timeseries"], key=lambda item: abs((parse_time(item["time"]) - now).total_seconds()))
        if abs((parse_time(row["time"]) - now).total_seconds()) > 3600:
            raise ValueError("MET has no forecast near the current time")
        details = row["data"]["instant"]["details"]
        values = {key: details[field] for key, field in fields.items()}
        self._validate_values("weather", values)
        return {"values": values, "source_time": parse_time(row["time"]).isoformat(),
                "fetched_at": self.met_fetched_at, "interval_seconds": 3600,
                "provider": "MET Norway Locationforecast", "attribution_url": MET_ATTRIBUTION,
                "license": "CC BY 4.0", "data_kind": "weather_model_forecast"}

    async def _persist_cache(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        # Independent refreshes must never overwrite or rename each other's temp.
        temp = self.path.with_name(f".{self.path.name}.{uuid4().hex}.tmp")
        try:
            temp.write_text(json.dumps({"version": 1, **self.cache}, ensure_ascii=False), encoding="utf-8")
            for attempt in range(4):
                try:
                    temp.replace(self.path)
                    return
                except PermissionError:
                    # Windows readers/virus scanners can briefly deny replacement.
                    # Keep the previous complete cache and surface a lasting error.
                    if attempt == 3:
                        raise
                    await asyncio.sleep(.05 * 2 ** attempt)
        finally:
            try:
                temp.unlink(missing_ok=True)
            except OSError:
                log.warning("Cannot remove temporary background cache %s", temp)

    def snapshot(self) -> dict:
        result = {"kind": "model_background", "provider": "Open-Meteo / CAMS",
                  "requested_latitude": 51.1694, "requested_longitude": 71.4491,
                  "poll_interval_seconds": self.settings.background_interval_seconds,
                  "units": UNITS, "attribution_url": "https://open-meteo.com/en/docs/air-quality-api"}
        if self.cache.get("weather", {}).get("provider") == "MET Norway Locationforecast":
            result["provider"] += " + MET Norway"
        now = utcnow()
        for part in FIELDS:
            cached = self.cache.get(part)
            age = (now - parse_time(cached["fetched_at"])).total_seconds() if cached else None
            usable = cached is not None and 0 <= age <= self.settings.cache_max_age_seconds
            if usable:
                block = deepcopy(cached)
                block["status"] = "cached" if part in self.errors or part in self.loaded else "live"
            else:
                block = {"values": deepcopy(DEFAULTS[part]), "source_time": None,
                         "fetched_at": None, "interval_seconds": None, "status": "default"}
                if cached:
                    block["last_available_at"] = cached["source_time"]
            block["cache_age_seconds"] = round(age, 1) if age is not None else None
            block["error"] = self.errors.get(part)
            result[part] = block
        return result

    async def run(self):
        while True:
            await asyncio.sleep(self.settings.background_interval_seconds)
            try:
                await self.refresh()
            except OSError:
                log.exception("Cannot persist background cache")
