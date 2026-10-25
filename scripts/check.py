"""Repeatable checks with a fresh workspace-local pytest directory for every run."""
import argparse
import os
from pathlib import Path
import shutil
import subprocess
import sys
import uuid

ROOT = Path(__file__).resolve().parents[1]


def main(argv=None):
    parser = argparse.ArgumentParser(description="Проверки ASTRA в отдельном временном каталоге")
    parser.add_argument("--javascript", action="store_true", help="Также проверить JavaScript отчёта (нужен Node.js)")
    parser.add_argument("--node", help="Путь к Node.js; также включает JavaScript-тесты")
    args = parser.parse_args(argv)
    node = args.node or shutil.which("node")
    if (args.javascript or args.node) and not node:
        parser.error("Node.js не найден; задайте --node или запустите только Python-проверки")
    base = ROOT / "artifacts" / "checks"
    base.mkdir(parents=True, exist_ok=True)
    temporary = base / uuid.uuid4().hex
    env = {**os.environ, "PYTHONUTF8": "1"}
    command = [sys.executable, "-m", "pytest", "tests", "-q", "-p", "no:cacheprovider",
               "--basetemp", str(temporary)]
    result = subprocess.run(command, cwd=ROOT, env=env, check=False)
    if result.returncode:
        return result.returncode
    if args.javascript or args.node:
        return subprocess.run([node, "--test", "tests/report.test.cjs", "tests/nature.test.cjs",
                               "tests/i18n.test.cjs"], cwd=ROOT,
                              env=env, check=False).returncode
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
