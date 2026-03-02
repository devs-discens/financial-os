from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    port: int = 3020
    database_url: str = "postgresql://financial_os:financial_os@localhost:5433/financial_os"
    registry_url: str = "http://localhost:3010"

    # PII Filter Gateway
    pii_filter_url: str = "http://localhost:3030"

    # LLM configuration
    llm_provider: str = "anthropic"
    llm_model: str = "claude-opus-4-6"
    anthropic_api_key: str = ""
    openai_api_key: str = ""
    gemini_api_key: str = ""

    # JWT authentication
    jwt_secret: str = "financial-os-dev-secret-change-in-prod"
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 60
    refresh_token_expire_days: int = 7

    # LLM output limits
    llm_max_tokens: int = 8192

    # Background orchestration
    polling_interval_seconds: int = 30
    token_refresh_buffer_seconds: int = 300
    anomaly_balance_threshold: float = 0.20
    background_enabled: bool = True

    # Logging configuration
    log_level: str = "INFO"
    log_format: str = "%(asctime)s %(name)s [%(levelname)s] %(message)s"
    log_file: str = ""
    log_max_bytes: int = 10 * 1024 * 1024  # 10 MB
    log_backup_count: int = 5

    model_config = {"env_prefix": "ONBOARDING_"}

    @property
    def llm_api_key(self) -> str:
        keys = {
            "anthropic": self.anthropic_api_key,
            "openai": self.openai_api_key,
            "gemini": self.gemini_api_key,
        }
        return keys.get(self.llm_provider, "")


settings = Settings()
