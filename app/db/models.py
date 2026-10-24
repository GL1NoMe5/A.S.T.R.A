from datetime import datetime

from sqlalchemy import DateTime, Index, JSON, String
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class Sensor(Base):
    __tablename__ = "sensors"
    id: Mapped[str] = mapped_column(String(20), primary_key=True)
    payload: Mapped[dict] = mapped_column(JSON)


class Telemetry(Base):
    __tablename__ = "telemetry"
    sensor_id: Mapped[str] = mapped_column(String(20), primary_key=True)
    timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True), primary_key=True)
    payload: Mapped[dict] = mapped_column(JSON)
    __table_args__ = (Index("ix_telemetry_time", "timestamp"),)


class MinuteAggregate(Base):
    __tablename__ = "minute_aggregates"
    sensor_id: Mapped[str] = mapped_column(String(20), primary_key=True)
    timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True), primary_key=True)
    payload: Mapped[dict] = mapped_column(JSON)
    __table_args__ = (Index("ix_aggregate_time", "timestamp"),)


class OptimizationRun(Base):
    __tablename__ = "optimization_runs"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    payload: Mapped[dict] = mapped_column(JSON)
