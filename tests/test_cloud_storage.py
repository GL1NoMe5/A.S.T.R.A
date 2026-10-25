import ssl
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.core.config import Settings
from app.db.cloud import cloud_database_options
from app.db.session import create_storage


def test_neon_url_preserves_credentials_and_requires_verified_tls():
    url, options = cloud_database_options(
        "postgresql://demo:p%40ss@db.example/astra?sslmode=require&channel_binding=require")
    assert url.drivername == "postgresql+asyncpg"
    assert url.password == "p@ss" and url.database == "astra"
    assert not url.query
    assert options["ssl"].verify_mode == ssl.CERT_REQUIRED
    assert options["ssl"].check_hostname
    with pytest.raises(ValueError):
        cloud_database_options("postgresql://demo:pass@db.example/astra?sslmode=disable")
    with pytest.raises(ValueError):
        cloud_database_options("sqlite:///test.db")


async def test_cloud_uses_postgres_without_redis_and_never_falls_back(monkeypatch, tmp_path):
    engine = MagicMock()
    engine.dispose = AsyncMock()
    connection = AsyncMock()
    engine.connect.return_value.__aenter__ = AsyncMock(return_value=connection)
    engine.connect.return_value.__aexit__ = AsyncMock(return_value=False)
    monkeypatch.setattr("app.db.session.create_async_engine", lambda *a, **kw: engine)
    settings = Settings(mode="cloud", data_dir=tmp_path,
                        database_url="postgresql://demo:secret@db.example/astra")
    storage = await create_storage(settings)
    assert storage.redis is None and storage.mode == "cloud"
    assert storage.engine is engine
    connection.execute.assert_awaited_once()
    engine.connect.return_value.__aenter__.side_effect = OSError("database is unavailable")
    with pytest.raises(RuntimeError, match="Cloud PostgreSQL unavailable") as error:
        await create_storage(settings)
    assert "secret" not in str(error.value)
    engine.dispose.assert_awaited_once()
    assert not (tmp_path / "astra.db").exists()
    with pytest.raises(RuntimeError, match="ASTRA_DATABASE_URL"):
        await create_storage(Settings(mode="cloud", data_dir=tmp_path))
