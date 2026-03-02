import logging
import logging.handlers
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .db.database import init_pool, close_pool
from .db.migrations import run_migrations
from .services.http_client import close_http_client
from .routes import onboarding, connections, templates, twin, council, background, dags, debug, auth, admin, admin_demo, progress, goals
from .services.background import BackgroundOrchestrator
from .services.auth import seed_users
from .routes.admin_demo import seed_all_wealthsimple
from .services import twin as twin_service
from .routes.background import set_orchestrator


def setup_logging() -> None:
    """Configure root logger with console + optional rotating file handler."""
    level = getattr(logging, settings.log_level.upper(), logging.INFO)
    fmt = logging.Formatter(settings.log_format)

    root = logging.getLogger("onboarding")
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
        logging.getLogger("httpx").setLevel(logging.WARNING)
        logging.getLogger("httpcore").setLevel(logging.WARNING)
        logging.getLogger("asyncpg").setLevel(logging.WARNING)
        logging.getLogger("uvicorn.access").setLevel(logging.WARNING)


setup_logging()
logger = logging.getLogger("onboarding")


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info(
        "Starting Onboarding Orchestrator | port=%d log_level=%s llm=%s/%s",
        settings.port, settings.log_level, settings.llm_provider, settings.llm_model,
    )
    if settings.log_file:
        logger.info(
            "File logging enabled: %s (max %d bytes, %d backups)",
            settings.log_file, settings.log_max_bytes, settings.log_backup_count,
        )

    pool = await init_pool(settings.database_url)
    await run_migrations(pool)
    await seed_users(pool)

    # Seed Wealthsimple on-platform data (existing customers)
    ws_seeded = await seed_all_wealthsimple(pool)
    if ws_seeded > 0:
        # Compute initial metrics so twin snapshots include Wealthsimple balances
        from .routes.admin_demo import WEALTHSIMPLE_ACCOUNTS
        for uid in WEALTHSIMPLE_ACCOUNTS:
            await twin_service.compute_metrics(pool, uid)
        logger.info("Twin ← computed initial metrics for %d Wealthsimple users", len(WEALTHSIMPLE_ACCOUNTS))

    # Start background orchestration (Component 4)
    bg = BackgroundOrchestrator(pool)
    set_orchestrator(bg)
    await bg.start()

    logger.info("Onboarding Orchestrator ready on port %d", settings.port)
    yield

    await bg.stop()
    await close_http_client()
    await close_pool()
    logger.info("Onboarding Orchestrator shut down")


app = FastAPI(
    title="Dynamic Onboarding Orchestrator",
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

app.include_router(auth.router)
app.include_router(onboarding.router)
app.include_router(connections.router)
app.include_router(templates.router)
app.include_router(twin.router)
app.include_router(council.router)
app.include_router(background.router)
app.include_router(dags.router)
app.include_router(admin.router)
app.include_router(admin_demo.router)
app.include_router(progress.router)
app.include_router(goals.router)

# Debug routes — only when LOG_LEVEL=DEBUG (never in production)
if settings.log_level.upper() == "DEBUG":
    app.include_router(debug.router)
    logger.info("Debug routes enabled (LOG_LEVEL=DEBUG)")


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "service": "onboarding-orchestrator",
    }
