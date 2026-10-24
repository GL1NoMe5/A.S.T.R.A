from pathlib import Path
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="ASTRA_", env_file=".env", extra="ignore")

    mode: Literal["auto", "local", "docker"] = "auto"
    data_dir: Path = Path("data")
    database_url: str | None = None
    redis_url: str | None = None
    background_enabled: bool = True
    background_interval_seconds: float = Field(300, gt=0)
    http_timeout_seconds: float = Field(10, gt=0)
    cache_max_age_seconds: float = Field(86400, gt=0)
    tick_seconds: float = Field(2, ge=0.05)
    retention_minutes: int = Field(60, ge=1)
    aggregate_retention_hours: int = Field(24, ge=1)
    queue_size: int = Field(32, ge=1)
    seed: int = 42

    @property
    def sqlite_url(self) -> str:
        return "sqlite+aiosqlite:///" + (self.data_dir / "astra.db").resolve().as_posix()
