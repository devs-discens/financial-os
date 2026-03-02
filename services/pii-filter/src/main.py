import logging
import logging.handlers
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .services.session_store import cleanup_expired, session_count
from .routes import sessions, filter


def setup_logging() -> None:
    """Configure root logger with console + optional rotating file handler."""
    level = getattr(logging, settings.log_level.upper(), logging.INFO)
    fmt = logging.Formatter(settings.log_format)

    root = logging.getLogger("pii-filter")
    root.setLevel(level)
    root.handlers.clear()

    # Console handler — always present
    console = logging.StreamHandler()
    console.setLevel(level)
    console.setFormatter(fmt)
    root.addHandler(console)

    # Rotating file handler — when log_file is set
    if settings.log_file:
        file_handler = logging.handlers.RotatingFileHandler(
            filename=settings.log_file,
            maxBytes=settings.log_max_bytes,
            backupCount=settings.log_backup_count,
        )
        file_handler.setLevel(level)
        file_handler.setFormatter(fmt)
        root.addHandler(file_handler)

    # Quiet noisy libraries unless we're at DEBUG
    if level > logging.DEBUG:
        logging.getLogger("uvicorn.access").setLevel(logging.WARNING)


setup_logging()
logger = logging.getLogger("pii-filter")


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info(
        "Starting PII Filter Gateway | port=%d log_level=%s session_ttl=%ds",
        settings.port, settings.log_level, settings.session_ttl_seconds,
    )
    if settings.log_file:
        logger.info(
            "File logging enabled: %s (max %d bytes, %d backups)",
            settings.log_file, settings.log_max_bytes, settings.log_backup_count,
        )
    yield
    # Cleanup on shutdown
    removed = cleanup_expired()
    remaining = session_count()
    logger.info(
        "PII Filter Gateway shut down (cleaned %d expired, %d remaining sessions discarded)",
        removed, remaining,
    )


app = FastAPI(
    title="PII Filter Gateway",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(sessions.router)
app.include_router(filter.router)


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "service": "pii-filter",
        "active_sessions": session_count(),
    }
