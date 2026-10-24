"""Download pinned public browser assets once; runtime has no CDN dependency."""
import asyncio
from pathlib import Path

import httpx

DEST = Path(__file__).resolve().parents[1] / "app" / "static" / "vendor"
ASSETS = {
    "leaflet.js": "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js",
    "leaflet.css": "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css",
    "leaflet-heat.js": "https://unpkg.com/leaflet.heat@0.2.0/dist/leaflet-heat.js",
    "plotly.min.js": "https://cdn.plot.ly/plotly-2.35.3.min.js",
    "plotly-locale-ru.js": "https://unpkg.com/plotly.js@2.35.3/dist/plotly-locale-ru.js",
    "leaflet-LICENSE.txt": "https://unpkg.com/leaflet@1.9.4/LICENSE",
    "leaflet-heat-LICENSE.txt": "https://unpkg.com/leaflet.heat@0.2.0/LICENSE",
    "plotly-LICENSE.txt": "https://unpkg.com/plotly.js@2.35.3/LICENSE",
    "tailwind-LICENSE.txt": "https://unpkg.com/tailwindcss@3.4.17/LICENSE",
    "images/layers.png": "https://unpkg.com/leaflet@1.9.4/dist/images/layers.png",
    "images/layers-2x.png": "https://unpkg.com/leaflet@1.9.4/dist/images/layers-2x.png",
    "images/marker-icon.png": "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
    "images/marker-icon-2x.png": "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
    "images/marker-shadow.png": "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
}


async def main():
    async with httpx.AsyncClient(follow_redirects=True, timeout=90) as client:
        async def fetch(name, url):
            response = await client.get(url)
            response.raise_for_status()
            path = DEST / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(response.content)
            print(name, len(response.content))
        await asyncio.gather(*(fetch(name, url) for name, url in ASSETS.items()))


if __name__ == "__main__":
    asyncio.run(main())
