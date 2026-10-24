"""Virtual pilot zones. Coordinates and populations are demonstration assumptions."""
import math

DISTRICTS = {
    "yesil": "Есиль",
    "nura": "Нура",
    "almaty": "Алматы",
    "saryarka": "Сарыарка",
    "baikonyr": "Байконыр",
}


def make_zones() -> list[dict]:
    # Pilot labels do not assert official administrative boundaries. The 40
    # disjoint model cells define population accounting, not real census areas.
    centres = [(51.128, 71.433), (51.143, 71.405), (51.145, 71.490),
               (51.175, 71.415), (51.177, 71.470)]
    result = []
    for district_index, (key, label) in enumerate(DISTRICTS.items()):
        lat, lon = centres[district_index]
        for j in range(8):
            n = district_index * 8 + j
            result.append({
                "id": f"AST-{n + 1:03d}", "name": f"{label} · зона {j + 1}",
                "district": key, "district_name": label,
                "latitude": round(lat + (j // 4 - 0.5) * 0.006, 6),
                "longitude": round(lon + (j % 4 - 1.5) * 0.008, 6),
                "density": round(0.35 + (n * 7 % 12) / 20, 3),
                "ndvi": round(0.12 + (n * 11 % 32) / 100, 3),
                "traffic_base": round(0.25 + (n * 13 % 65) / 100, 3),
                "area_m2": 120000 + (n % 5) * 20000,
                "planting_capacity": 200 + (n % 7) * 100,
                "population": 900 + (n * 379 % 3500),
                "metadata_kind": "scenario", "population_kind": "scenario_disjoint_cells",
            })
    return result


def distance_m(a: dict, b: dict) -> float:
    dy = (a["latitude"] - b["latitude"]) * 111320
    dx = (a["longitude"] - b["longitude"]) * 111320 * math.cos(math.radians(51.16))
    return math.hypot(dx, dy)
