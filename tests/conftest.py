from pathlib import Path
import sys

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.zones import make_zones


@pytest.fixture(scope="session")
def zones():
    return make_zones()


@pytest.fixture(scope="session")
def ml(tmp_path_factory, zones):
    from app.ml.engine import MLEngine
    engine = MLEngine(tmp_path_factory.mktemp("models"), zones)
    engine.initialize()
    return engine
