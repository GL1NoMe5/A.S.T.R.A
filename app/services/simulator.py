"""Shared synthetic process for virtual stations and demonstration training data."""
from datetime import datetime
import math

import numpy as np


def stress_index(pm25: float, no2: float, surface_temp: float) -> float:
    """ESI v1: a scenario index, not a health or regulatory index."""
    clip = lambda x: min(1.0, max(0.0, x))
    return round(100 * (0.5 * clip(pm25 / 100) + 0.2 * clip(no2 / 100)
                        + 0.3 * clip((surface_temp - 25) / 20)), 3)


def simulate_reading(zone: dict, timestamp: datetime, background: dict,
                     rng: np.random.Generator, noise_scale: float = 1.0) -> dict:
    air = background["air"]["values"]
    weather = background["weather"]["values"]
    hour = (timestamp.hour + timestamp.minute / 60 + 5) % 24
    rush = math.exp(-((hour - 8.5) / 2) ** 2) + math.exp(-((hour - 18) / 2.5) ** 2)
    traffic = min(1, max(0, zone["traffic_base"] * (0.55 + 0.5 * rush)
                          + rng.normal(0, 0.012) * noise_scale))
    wind = max(0.1, weather["wind_speed"] * (1 - 0.35 * zone["density"]))
    exposure = (0.8 + 0.55 * traffic + 0.25 * zone["density"] - 0.3 * zone["ndvi"])
    exposure *= 1 - 0.035 * min(10, wind)
    pm25 = max(0.1, air["pm25"] * exposure + rng.normal(0, 0.5) * noise_scale)
    pm10 = max(pm25, air["pm10"] * exposure + rng.normal(0, 0.6) * noise_scale)
    no2 = max(0.1, air["no2"] * (0.65 + traffic + 0.2 * zone["density"])
              + rng.normal(0, 0.4) * noise_scale)
    air_temp = weather["air_temp_c"] + 0.8 * zone["density"] - 0.5 * zone["ndvi"]
    sun = max(0, math.sin((hour - 6) / 12 * math.pi))
    surface = air_temp + sun * (4 + 8 * zone["density"] - 6 * zone["ndvi"])
    surface += rng.normal(0, 0.08) * noise_scale
    return {
        "sensor_id": zone["id"], "timestamp": timestamp.isoformat(),
        "pm25": round(pm25, 3), "pm10": round(pm10, 3), "no2": round(no2, 3),
        "co": round(max(0, air["co"] * (0.8 + traffic * 0.4)), 3),
        "co2": round(420 + 40 * traffic + 15 * zone["density"], 2),
        "air_temp_c": round(air_temp, 3), "surface_temp_c": round(surface, 3),
        "humidity": round(min(100, max(0, weather["humidity"] + zone["ndvi"] * 3)), 2),
        "wind_speed": round(wind, 3), "wind_direction": weather["wind_direction"],
        "traffic_index": round(traffic, 4), "esi": stress_index(pm25, no2, surface),
        "kind": "virtual_station", "surface_temperature_kind": "scenario",
        "co2_kind": "scenario", "background_air_status": background["air"]["status"],
        "background_weather_status": background["weather"]["status"],
        "background_air_source_time": background["air"]["source_time"],
        "background_weather_source_time": background["weather"]["source_time"],
    }
