import json
from pathlib import Path
import socket
import subprocess
from types import SimpleNamespace

import pytest

from scripts import run_local
from scripts.acceptance import stop_process, wait_ready


def test_launcher_overrides_mode_and_offline_without_mutating_environment(tmp_path):
    original = {"ASTRA_MODE": "docker", "ASTRA_BACKGROUND_ENABLED": "true", "OTHER": "keep"}
    command, env = run_local.launch_spec(8123, offline=True, data_dir=tmp_path, environ=original)
    assert env["ASTRA_MODE"] == "local" and env["ASTRA_BACKGROUND_ENABLED"] == "false"
    assert env["ASTRA_DATA_DIR"] == str(tmp_path.resolve()) and env["OTHER"] == "keep"
    assert original["ASTRA_MODE"] == "docker" and original["ASTRA_BACKGROUND_ENABLED"] == "true"
    assert command[-2:] == ["--workers", "1"]
    assert command[command.index("--host") + 1] == "127.0.0.1"
    assert command[command.index("--port") + 1] == "8123"


def test_relative_data_directory_is_rooted_in_project(monkeypatch, tmp_path):
    monkeypatch.chdir(tmp_path)
    _, env = run_local.launch_spec(data_dir="artifacts/demo", environ={})
    assert Path(env["ASTRA_DATA_DIR"]) == run_local.ROOT / "artifacts/demo"
    _, env = run_local.launch_spec(environ={"ASTRA_BACKGROUND_ENABLED": "false"})
    assert env["ASTRA_BACKGROUND_ENABLED"] == "false"
    assert "ASTRA_DATA_DIR" not in env  # Let settings read the existing .env unless explicitly overridden.


def test_diagnostics_detect_missing_package_and_asset_without_starting(monkeypatch, tmp_path):
    monkeypatch.setattr(run_local, "PACKAGES", {"missing-astra-package": "missing_astra_package"})
    monkeypatch.setattr(run_local, "ASSETS", ("index.html",))
    report = run_local.environment_report(tmp_path)
    assert report["status"] == "error"
    assert report["missing_packages"] == ["missing-astra-package"]
    assert report["missing_assets"] == ["index.html"]


def test_occupied_port_is_not_killed_or_reused(monkeypatch, capsys):
    monkeypatch.setattr(run_local, "environment_report", lambda: {"status": "ok"})
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        listener.listen()
        port = listener.getsockname()[1]
        assert not run_local.port_available(port)
        monkeypatch.setattr(run_local.subprocess, "run", lambda *a, **k: pytest.fail("Must not launch"))
        assert run_local.main(["--port", str(port)]) == 2
        assert "уже занят" in capsys.readouterr().err
        assert run_local.main(["--check", "--port", str(port)]) == 0
        assert json.loads(capsys.readouterr().out)["port_available"] is False


async def test_acceptance_fails_immediately_when_child_exits():
    dead = SimpleNamespace(poll=lambda: 2, returncode=2)
    with pytest.raises(RuntimeError, match="код 2"):
        await wait_ready(dead, "http://127.0.0.1:1", timeout=1)


def test_cleanup_stops_only_the_process_object_and_escalates_if_needed():
    calls = []

    class Child:
        def poll(self):
            return None

        def terminate(self):
            calls.append("terminate")

        def kill(self):
            calls.append("kill")

        def wait(self, timeout):
            calls.append(("wait", timeout))
            if timeout == 10:
                raise subprocess.TimeoutExpired("test child", timeout)

    stop_process(Child())
    assert calls == ["terminate", ("wait", 10), "kill", ("wait", 5)]
    stop_process(None)
