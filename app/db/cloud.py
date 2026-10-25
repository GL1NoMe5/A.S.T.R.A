"""TLS-only PostgreSQL connection settings for a single cloud web instance."""
import ssl

from sqlalchemy.engine import make_url


def cloud_database_options(database_url: str):
    url = make_url(database_url)
    if url.drivername not in ("postgres", "postgresql", "postgresql+asyncpg"):
        raise ValueError("Cloud mode requires a PostgreSQL connection URL")
    query = dict(url.query)
    if query.pop("sslmode", "require") not in ("require", "verify-ca", "verify-full"):
        raise ValueError("Cloud PostgreSQL requires verified TLS")
    # Neon connection strings include libpq's channel_binding option. asyncpg
    # does not accept it; certificate and hostname verification remain mandatory.
    query.pop("channel_binding", None)
    query.pop("ssl", None)
    url = url.set(drivername="postgresql+asyncpg", query=query)
    return url, {"ssl": ssl.create_default_context(), "timeout": 30}
