from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    port: int = 3030

    # Session configuration
    session_ttl_seconds: int = 3600  # 1 hour default

    # Perturbation configuration
    amount_shift_min: float = 0.85
    amount_shift_max: float = 1.15
    date_shift_min_days: int = -30
    date_shift_max_days: int = 30
    percentage_shift: float = 0.5  # ±0.5%

    # Logging configuration
    log_level: str = "INFO"
    log_format: str = "%(asctime)s %(name)s [%(levelname)s] %(message)s"
    log_file: str = ""
    log_max_bytes: int = 10 * 1024 * 1024  # 10 MB
    log_backup_count: int = 5

    model_config = {"env_prefix": "PII_FILTER_"}


settings = Settings()
