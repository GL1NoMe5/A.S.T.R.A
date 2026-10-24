from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class OptimizeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    budget_trees: int = Field(1000, ge=100, le=10000)
    species: Literal["elm", "pine", "poplar"] = "elm"
    target_district: Literal["all", "yesil", "nura", "almaty", "saryarka", "baikonyr"] = "all"
    horizon_years: int = Field(10, ge=1, le=30)
    sapling_cost_kzt: float = Field(15000, ge=0, le=10000000)
    planting_cost_kzt: float = Field(10000, ge=0, le=10000000)
    annual_care_cost_kzt: float = Field(3000, ge=0, le=10000000)
    pilot_equipment_cost_kzt: float = Field(600000, ge=0, le=1e10)
    annual_platform_cost_kzt: float = Field(1200000, ge=0, le=1e10)


class TelemetryReading(BaseModel):
    sensor_id: str
    timestamp: str
    pm25: float = Field(ge=0)
    pm10: float = Field(ge=0)
    no2: float = Field(ge=0)
    co: float = Field(ge=0)
    co2: float = Field(ge=0)
    air_temp_c: float
    surface_temp_c: float
    humidity: float = Field(ge=0, le=100)
    wind_speed: float = Field(ge=0)
    wind_direction: float
    traffic_index: float = Field(ge=0, le=1)
    esi: float = Field(ge=0, le=100)
