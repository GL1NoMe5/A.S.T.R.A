"""Local launcher with diagnostics; no package installation or background processes."""
import argparse
import importlib.metadata
import importlib.util
import json
import os
from pathlib import Path
import socket
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
PACKAGES = {
    "fastapi": "fastapi", "uvicorn": "uvicorn", "sqlalchemy": "sqlalchemy",
    "aiosqlite": "aiosqlite", "asyncpg": "asyncpg", "redis": "redis",
    "httpx": "httpx", "pydantic-settings": "pydantic_settings", "anyio": "anyio",
    "numpy": "numpy", "pandas": "pandas", "scikit-learn": "sklearn",
    "lightgbm": "lightgbm", "shap": "shap", "joblib": "joblib",
}
ASSETS = (
    "atlas.css", "atlas-motion.js", "assets/atlas-day.webp", "assets/atlas-night.webp", "assets/atlas-winter.webp",
    "index.html", "app.js", "i18n.js", "style.css", "workspace.css", "theme.js", "themes.css", "nature.js", "nature.css", "interactions.js", "report/report.html", "report/report.js", "report/report-i18n.js",
    "report/report.css", "vendor/leaflet.js", "vendor/leaflet.css",
    "vendor/leaflet-heat.js", "vendor/plotly.min.js", "vendor/plotly-locale-ru.js",
    "vendor/tailwind.css",
)


def environment_report(root=ROOT):
    """Read-only checks. Imports/native DLL loading are verified by actual startup."""
    versions, missing = {}, []
    for distribution, module in PACKAGES.items():
        try:
            if importlib.util.find_spec(module) is None:
                raise importlib.metadata.PackageNotFoundError(distribution)
            versions[distribution] = importlib.metadata.version(distribution)
        except importlib.metadata.PackageNotFoundError:
            missing.append(distribution)
    missing_assets = [name for name in ASSETS if not (root / "app/static" / name).is_file()]
    python_ok = sys.version_info >= (3, 12)
    return {"status": "ok" if python_ok and not missing and not missing_assets else "error",
            "python": sys.version.split()[0], "python_supported": python_ok,
            "python_executable": sys.executable, "project": str(root),
            "packages": versions, "missing_packages": missing, "missing_assets": missing_assets}


def port_available(port):
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as listener:
        if hasattr(socket, "SO_EXCLUSIVEADDRUSE"):
            listener.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        try:
            listener.bind(("127.0.0.1", port))
            return True
        except OSError:
            return False


def launch_spec(port=8010, offline=False, data_dir=None, environ=None):
    env = dict(os.environ if environ is None else environ)
    env.update(ASTRA_MODE="local", PYTHONUTF8="1", PYTHONUNBUFFERED="1")
    if offline:
        env["ASTRA_BACKGROUND_ENABLED"] = "false"
    if data_dir is not None:
        path = Path(data_dir)
        env["ASTRA_DATA_DIR"] = str((ROOT / path).resolve())
    command = [sys.executable, "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1",
               "--port", str(port), "--workers", "1"]
    return command, env


def main(argv=None):
    parser = argparse.ArgumentParser(description="Запуск ASTRA: локальная SQLite и очередь в памяти")
    parser.add_argument("--port", type=int, default=8010, help="Локальный порт (по умолчанию 8010)")
    parser.add_argument("--offline", action="store_true", help="Не опрашивать Open-Meteo; кэш или резервный фон")
    parser.add_argument("--data-dir", help="Отдельный каталог данных, относительный путь считается от проекта")
    parser.add_argument("--check", action="store_true", help="Проверить окружение, ничего не запускать")
    args = parser.parse_args(argv)
    if not 1 <= args.port <= 65535:
        parser.error("Порт должен быть от 1 до 65535")
    report = environment_report()
    report["port"] = args.port
    report["port_available"] = port_available(args.port)
    if args.check:
        print(json.dumps(report, ensure_ascii=False, indent=2))
        return 0 if report["status"] == "ok" else 2
    if report["status"] != "ok":
        print(json.dumps(report, ensure_ascii=False, indent=2), file=sys.stderr)
        print("Нужно окружение Python 3.12 с зависимостями проекта. См. README.md.", file=sys.stderr)
        return 2
    if not report["port_available"]:
        print(f"Порт {args.port} уже занят. Если ASTRA запущена, откройте http://127.0.0.1:{args.port}/. "
              "Для отдельного экземпляра задайте другой --port и отдельный --data-dir.", file=sys.stderr)
        return 2
    command, env = launch_spec(args.port, args.offline, args.data_dir)
    print(f"ASTRA: http://127.0.0.1:{args.port}/ · остановка Ctrl+C", flush=True)
    if args.offline:
        print("Автономный режим: сохранённый модельный фон или явно обозначенные резервные значения.", flush=True)
    try:
        return subprocess.run(command, cwd=ROOT, env=env, check=False).returncode
    except KeyboardInterrupt:
        return 130


if __name__ == "__main__":
    raise SystemExit(main())
