"""Generates custom botanical and urban-ecology SVG assets for README.md (docs/readme/)."""
import os

ROOT = os.path.dirname(os.path.abspath(__file__))
ICONS = os.path.join(ROOT, "icons")
os.makedirs(ICONS, exist_ok=True)

FOREST = "#1b3529"
PINE = "#2d5a43"
SAGE = "#6b8c6e"
MINT = "#9cad83"
CREAM = "#f4f1e6"
BORDER = "#d5ceb8"
OCHRE = "#d49b4b"
TERRA = "#b9775a"
SLATE = "#4e6766"
INK = "#223127"


def icon(name: str, body: str, bg: str = CREAM) -> None:
    svg = (
        '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">'
        f'<rect x="2" y="2" width="60" height="60" rx="16" fill="{bg}" stroke="{BORDER}" stroke-width="2"/>'
        f"{body}</svg>"
    )
    with open(os.path.join(ICONS, f"{name}.svg"), "w", encoding="utf-8") as f:
        f.write(svg)


# 1. Leaf / Ecology (About project)
icon("leaf", (
    f'<path d="M18 46C18 26 31 15 47 15C47 31 38 46 21 46Z" fill="{SAGE}" stroke="{FOREST}" stroke-width="1.8" stroke-linejoin="round"/>'
    f'<path d="M16 48C25 39 34 30 43 20" fill="none" stroke="{CREAM}" stroke-width="1.8" stroke-linecap="round"/>'
    f'<path d="M27 37L23 31M34 30L30 24M31 35L38 34" fill="none" stroke="{CREAM}" stroke-width="1.5" stroke-linecap="round"/>'
    f'<circle cx="45" cy="18" r="2.5" fill="{OCHRE}"/>'
))

# 2. Sparkle / Features
icon("sparkle", (
    f'<path d="M30 12L34 26L48 30L34 34L30 48L26 34L12 30L26 26Z" fill="{OCHRE}" stroke="{FOREST}" stroke-width="1.4" stroke-linejoin="round"/>'
    f'<path d="M46 40L47.6 44.4L52 46L47.6 47.6L46 52L44.4 47.6L40 46L44.4 44.4Z" fill="{PINE}"/>'
    f'<circle cx="18" cy="18" r="2.5" fill="{SAGE}"/>'
))

# 3. Map / 40 districts
icon("map", (
    f'<path d="M12 18L25 14L39 19L52 15V46L39 50L25 45L12 49Z" fill="#eae5d3" stroke="{FOREST}" stroke-width="1.8" stroke-linejoin="round"/>'
    f'<path d="M25 14V45M39 19V50" stroke="{SAGE}" stroke-width="1.5" stroke-dasharray="3 2"/>'
    f'<circle cx="20" cy="29" r="3.5" fill="{PINE}"/>'
    f'<circle cx="32" cy="26" r="4" fill="{OCHRE}" stroke="{FOREST}" stroke-width="1.2"/>'
    f'<circle cx="45" cy="35" r="3.5" fill="{PINE}"/>'
))

# 4. Tree / Planting scenario
icon("tree", (
    f'<ellipse cx="32" cy="50" rx="14" ry="3.5" fill="#dfd8c2"/>'
    f'<path d="M30 34H34V49H30Z" fill="{TERRA}" stroke="{FOREST}" stroke-width="1.5"/>'
    f'<circle cx="24" cy="29" r="9" fill="{SAGE}"/>'
    f'<circle cx="40" cy="29" r="9" fill="{SAGE}"/>'
    f'<circle cx="32" cy="22" r="11" fill="{PINE}"/>'
    f'<path d="M32 38L28 33M32 36L36 32" stroke="{FOREST}" stroke-width="1.5" stroke-linecap="round"/>'
))

# 5. Wind / Air & Weather (Open-Meteo / CAMS)
icon("wind", (
    f'<path d="M13 25H41C45 25 47 22 47 19C47 16 44 14 41 14C38 14 36 16 36 18" fill="none" stroke="{SLATE}" stroke-width="2.4" stroke-linecap="round"/>'
    f'<path d="M11 33H47C51 33 53 36 53 39C53 42 50 45 47 45C44 45 42 43 42 40" fill="none" stroke="{PINE}" stroke-width="2.4" stroke-linecap="round"/>'
    f'<path d="M15 41H33C36 41 38 43 38 46C38 48.5 36 50 33.5 50" fill="none" stroke="{SAGE}" stroke-width="2.2" stroke-linecap="round"/>'
    f'<circle cx="22" cy="18" r="2.2" fill="{OCHRE}"/>'
    f'<circle cx="50" cy="25" r="2" fill="{SAGE}"/>'
))

# 6. Chart / Forecast & SHAP
icon("chart", (
    f'<rect x="14" y="34" width="7" height="14" rx="2" fill="{MINT}" stroke="{FOREST}" stroke-width="1.4"/>'
    f'<rect x="25" y="26" width="7" height="22" rx="2" fill="{SAGE}" stroke="{FOREST}" stroke-width="1.4"/>'
    f'<rect x="36" y="18" width="7" height="30" rx="2" fill="{PINE}" stroke="{FOREST}" stroke-width="1.4"/>'
    f'<path d="M14 27L26 20L38 14L49 17" fill="none" stroke="{OCHRE}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>'
    f'<circle cx="49" cy="17" r="3" fill="{OCHRE}" stroke="{FOREST}" stroke-width="1.2"/>'
    f'<path d="M11 48H53" stroke="{FOREST}" stroke-width="1.8" stroke-linecap="round"/>'
))

# 7. Budget / Tenge Estimate
icon("budget", (
    f'<rect x="13" y="16" width="38" height="32" rx="6" fill="#ece6d4" stroke="{FOREST}" stroke-width="1.8"/>'
    f'<circle cx="32" cy="32" r="11" fill="{OCHRE}" opacity=".28"/>'
    f'<path d="M25 24H39M25 28.5H39M32 28.5V41" fill="none" stroke="{FOREST}" stroke-width="2.4" stroke-linecap="round"/>'
    f'<circle cx="45" cy="22" r="2" fill="{PINE}"/>'
    f'<circle cx="19" cy="42" r="2" fill="{PINE}"/>'
))

# 8. Compare / A-B plans
icon("compare", (
    f'<rect x="12" y="15" width="18" height="34" rx="4" fill="#e9e3d0" stroke="{FOREST}" stroke-width="1.6"/>'
    f'<rect x="34" y="15" width="18" height="34" rx="4" fill="{PINE}" stroke="{FOREST}" stroke-width="1.6"/>'
    f'<path d="M16 23H26M16 29H24M16 35H26" stroke="{FOREST}" stroke-width="1.6" stroke-linecap="round"/>'
    f'<path d="M38 23H48M38 29H46M38 35H48" stroke="{CREAM}" stroke-width="1.6" stroke-linecap="round"/>'
    f'<circle cx="21" cy="42" r="2.5" fill="{OCHRE}"/>'
    f'<circle cx="43" cy="42" r="2.5" fill="{OCHRE}"/>'
))

# 9. Report / Printable A4
icon("report", (
    f'<rect x="17" y="11" width="30" height="42" rx="3.5" fill="#faf7ef" stroke="{FOREST}" stroke-width="1.8"/>'
    f'<path d="M22 19H42M22 25H36" stroke="{FOREST}" stroke-width="1.8" stroke-linecap="round"/>'
    f'<rect x="22" y="30" width="20" height="10" rx="2" fill="{SAGE}" opacity=".45"/>'
    f'<path d="M22 45H38" stroke="{OCHRE}" stroke-width="2" stroke-linecap="round"/>'
    f'<circle cx="41" cy="45" r="2" fill="{PINE}"/>'
))

# 10. Palette / 3 Themes & 3 Languages
icon("palette", (
    f'<path d="M32 13C20 13 12 21 12 31C12 42 21 51 31 51C35 51 36 48 34 45C32 42 34 39 38 39H43C48 39 52 35 52 30C52 20 43 13 32 13Z" fill="#ece6d4" stroke="{FOREST}" stroke-width="1.8"/>'
    f'<circle cx="22" cy="26" r="4" fill="{PINE}"/>'
    f'<circle cx="32" cy="21" r="4" fill="{OCHRE}"/>'
    f'<circle cx="42" cy="26" r="4" fill="{TERRA}"/>'
    f'<circle cx="21" cy="36" r="4" fill="{SLATE}"/>'
))

# 11. Rocket / Quick start
icon("rocket", (
    f'<path d="M32 12C39 18 42 27 40 37L32 43L24 37C22 27 25 18 32 12Z" fill="{PINE}" stroke="{FOREST}" stroke-width="1.8" stroke-linejoin="round"/>'
    f'<circle cx="32" cy="26" r="4" fill="{CREAM}"/>'
    f'<path d="M24 32L17 38L23 41ZM40 32L47 38L41 41Z" fill="{OCHRE}" stroke="{FOREST}" stroke-width="1.4" stroke-linejoin="round"/>'
    f'<path d="M29 44L32 52L35 44" fill="{OCHRE}"/>'
))

# 12. Gallery / Screenshots & Video
icon("gallery", (
    f'<rect x="11" y="15" width="42" height="34" rx="5" fill="#ece6d4" stroke="{FOREST}" stroke-width="1.8"/>'
    f'<circle cx="41" cy="25" r="4" fill="{OCHRE}"/>'
    f'<path d="M13 45L25 31L34 40L40 34L51 45Z" fill="{PINE}"/>'
))

# 13. Compass / Hackathon & Pilot
icon("compass", (
    f'<circle cx="32" cy="32" r="19" fill="#ece6d4" stroke="{FOREST}" stroke-width="1.8"/>'
    f'<polygon points="32,17 37,32 32,29 27,32" fill="{OCHRE}" stroke="{FOREST}" stroke-width="1.2" stroke-linejoin="round"/>'
    f'<polygon points="32,47 37,32 32,35 27,32" fill="{PINE}" stroke="{FOREST}" stroke-width="1.2" stroke-linejoin="round"/>'
    f'<circle cx="32" cy="32" r="2.5" fill="{CREAM}" stroke="{FOREST}" stroke-width="1.2"/>'
))

# 14. Question / Details & FAQ
icon("question", (
    f'<circle cx="32" cy="32" r="19" fill="#ece6d4" stroke="{FOREST}" stroke-width="1.8"/>'
    f'<path d="M26 26C26 21.5 29 19 32.5 19C36.5 19 39.5 21.8 39.5 25.5C39.5 30.5 32.5 30.8 32.5 36.5" fill="none" stroke="{PINE}" stroke-width="3.4" stroke-linecap="round"/>'
    f'<circle cx="32.5" cy="43.5" r="2.5" fill="{OCHRE}"/>'
))

# 15. Shield / Verification & Honesty
icon("shield", (
    f'<path d="M32 12L48 18V31C48 41 41 48 32 52C23 48 16 41 16 31V18Z" fill="{SAGE}" stroke="{FOREST}" stroke-width="1.8" stroke-linejoin="round"/>'
    f'<path d="M25 32L30 37L40 26" fill="none" stroke="{CREAM}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>'
))

# Closing full-width illustration: Astana Green Boulevard & Park at Dusk
closing_svg = f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 260" width="100%" role="img" aria-label="Зелёная аллея Астаны">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#1b3529"/>
      <stop offset="65%" stop-color="#294c3a"/>
      <stop offset="100%" stop-color="#38624b"/>
    </linearGradient>
    <radialGradient id="sun" cx="78%" cy="34%" r="38%">
      <stop offset="0%" stop-color="#f3d088" stop-opacity="0.55"/>
      <stop offset="55%" stop-color="#d49b4b" stop-opacity="0.18"/>
      <stop offset="100%" stop-color="#d49b4b" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="1280" height="260" rx="20" fill="url(#sky)"/>
  <rect width="1280" height="260" rx="20" fill="url(#sun)"/>
  <rect x="14" y="14" width="1252" height="232" rx="14" fill="none" stroke="#9cad83" stroke-opacity="0.32"/>

  <!-- Warm sun / moon glow -->
  <circle cx="998" cy="84" r="34" fill="#f2d594" opacity="0.85"/>
  <circle cx="998" cy="84" r="48" fill="none" stroke="#f2d594" stroke-opacity="0.25" stroke-width="1.5"/>

  <!-- Distant city skyline silhouette -->
  <g fill="#213d2f" opacity="0.85">
    <rect x="420" y="118" width="38" height="82" rx="2"/>
    <rect x="468" y="102" width="44" height="98" rx="2"/>
    <rect x="524" y="128" width="34" height="72" rx="2"/>
    <rect x="640" y="112" width="46" height="88" rx="2"/>
    <rect x="698" y="96" width="38" height="104" rx="2"/>
    <rect x="748" y="124" width="52" height="76" rx="2"/>
    <!-- Spire silhouette -->
    <path d="M594 198L600 92L606 198Z"/>
    <circle cx="600" cy="86" r="11" fill="#d49b4b" opacity="0.8"/>
  </g>

  <!-- Soft rolling park hills -->
  <path d="M0 198Q220 162 470 188T960 178T1280 192V260H0Z" fill="#254636"/>
  <path d="M0 212Q340 184 680 206T1280 198V260H0Z" fill="#172d22"/>

  <!-- Boulevard trees (elms, pines, poplars) -->
  <g>
    <!-- Left grove -->
    <rect x="108" y="168" width="6" height="36" fill="#8b6b4f"/>
    <circle cx="111" cy="152" r="24" fill="#5e8262"/>
    <circle cx="98" cy="160" r="16" fill="#486b4d"/>
    <circle cx="124" cy="160" r="16" fill="#7c9c77"/>

    <rect x="176" y="162" width="6" height="42" fill="#8b6b4f"/>
    <path d="M179 112L157 166H201Z" fill="#3d6649"/>
    <path d="M179 128L161 174H197Z" fill="#527b58"/>

    <rect x="244" y="170" width="6" height="34" fill="#8b6b4f"/>
    <circle cx="247" cy="154" r="22" fill="#6b8c6e"/>
    <circle cx="235" cy="162" r="15" fill="#527650"/>
    <circle cx="260" cy="160" r="15" fill="#9cad83"/>

    <rect x="318" y="172" width="5" height="32" fill="#8b6b4f"/>
    <ellipse cx="320.5" cy="148" rx="14" ry="28" fill="#5e8262"/>
    <ellipse cx="325" cy="148" rx="9" ry="24" fill="#7c9c77"/>

    <!-- Right grove -->
    <rect x="858" y="168" width="6" height="34" fill="#8b6b4f"/>
    <circle cx="861" cy="150" r="23" fill="#5e8262"/>
    <circle cx="848" cy="158" r="16" fill="#486b4d"/>
    <circle cx="875" cy="157" r="16" fill="#9cad83"/>

    <rect x="932" y="164" width="5" height="38" fill="#8b6b4f"/>
    <path d="M934.5 116L914 168H955Z" fill="#3d6649"/>
    <path d="M934.5 132L918 175H951Z" fill="#5e8262"/>

    <rect x="1068" y="166" width="6" height="38" fill="#8b6b4f"/>
    <circle cx="1071" cy="148" r="25" fill="#6b8c6e"/>
    <circle cx="1056" cy="156" r="17" fill="#527650"/>
    <circle cx="1086" cy="156" r="17" fill="#9cad83"/>

    <rect x="1146" y="170" width="5" height="34" fill="#8b6b4f"/>
    <ellipse cx="1148.5" cy="146" rx="14" ry="27" fill="#527650"/>
    <ellipse cx="1153" cy="146" rx="9" ry="23" fill="#7c9c77"/>
  </g>

  <!-- Warm park lamps -->
  <g stroke="#d49b4b" stroke-width="1.5">
    <line x1="382" y1="176" x2="382" y2="204"/>
    <circle cx="382" cy="173" r="4" fill="#f6dfa4" stroke="none"/>
    <circle cx="382" cy="173" r="10" fill="#f6dfa4" opacity="0.22" stroke="none"/>

    <line x1="796" y1="174" x2="796" y2="202"/>
    <circle cx="796" cy="171" r="4" fill="#f6dfa4" stroke="none"/>
    <circle cx="796" cy="171" r="10" fill="#f6dfa4" opacity="0.22" stroke="none"/>
  </g>

  <!-- Caption bar -->
  <text x="640" y="236" text-anchor="middle" fill="#e4e9d9" font-family="'Segoe UI', Arial, sans-serif" font-size="13" letter-spacing="2" opacity="0.88">ASTRA · ГОРОДСКАЯ СРЕДА, ДЕРЕВЬЯ И ТЕНЬ ДЛЯ АСТАНЫ</text>
</svg>
"""

with open(os.path.join(ROOT, "astana-park.svg"), "w", encoding="utf-8") as f:
    f.write(closing_svg)

print("Generated README SVG assets in", ROOT)

import re

repo_root = os.path.abspath(os.path.join(ROOT, "..", ".."))
readme_path = os.path.join(repo_root, "README.md")
if os.path.exists(readme_path):
    text = open(readme_path, encoding="utf-8").read()
    emdash = text.count("\u2014")
    links = [
        u for u in re.findall(r'(?:src="|href="|\]\()([^"#)]+)', text)
        if not u.startswith("http")
    ]
    missing = [u for u in links if not os.path.exists(os.path.join(repo_root, u))]
    print(f"README check: emdash={emdash}, local_links={len(links)}, missing={missing}")

