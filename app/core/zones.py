"""Virtual pilot zones. Coordinates and populations are demonstration assumptions."""
import math

DISTRICTS = {
    "yesil": "Есиль",
    "nura": "Нура",
    "almaty": "Алматы",
    "saryarka": "Сарыарка",
    "baikonyr": "Байконыр",
}


# These profiles are explicit scenario assumptions, not measured land-use data.
# density, NDVI, traffic, area, capacity and population refer to a notional
# non-overlapping catchment around the reference point, not the named property.
PROFILES = {
    "park": (.18, .68, .16, 180000, 180, 900),
    "residential": (.62, .27, .40, 160000, 550, 3000),
    "arterial": (.70, .14, .84, 120000, 260, 2200),
    "industrial": (.48, .10, .65, 200000, 650, 700),
}


def make_zones() -> list[dict]:
    from pathlib import Path
    import json

    catalog = json.loads(Path(__file__).with_name("pilot_sites.json").read_text(encoding="utf-8"))
    result = []
    for n, site in enumerate(catalog["sites"]):
        density, ndvi, traffic, area, capacity, population = PROFILES[site["site_type"]]
        # Small deterministic within-type variation, never random coordinates.
        delta = ((n * 7) % 5 - 2) * .015
        result.append({
            **site, "name": site["name_i18n"]["ru"],
            "district_name": DISTRICTS[site["district"]],
            "density": round(density + delta, 3),
            "ndvi": round(ndvi - delta, 3),
            "traffic_base": round(traffic + delta, 3),
            "area_m2": area, "planting_capacity": capacity,
            "population": population + ((n % 3) - 1) * 100,
            "metadata_kind": "scenario", "population_kind": "scenario_disjoint_cells",
            "network_version": catalog["version"],
            "location_kind": catalog["location_kind"],
            "location_source": f"https://www.openstreetmap.org/?mlat={site['latitude']}&mlon={site['longitude']}#map=16/{site['latitude']}/{site['longitude']}",
        })
    return result


def distance_m(a: dict, b: dict) -> float:
    dy = (a["latitude"] - b["latitude"]) * 111320
    dx = (a["longitude"] - b["longitude"]) * 111320 * math.cos(math.radians(51.16))
    return math.hypot(dx, dy)
