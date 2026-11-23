from pathlib import Path
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    DATABASE_URL: str = "postgresql://scholaread:scholaread_dev_pass@localhost:5432/scholaread"
    ADMIN_USERNAME: str = "admin"
    ADMIN_PASSWORD: str = "scholaread123"
    JWT_SECRET: str = "dev-insecure-secret-change-in-production"
    JWT_EXPIRE_HOURS: int = 168

    DEFAULT_LLM_BASE_URL: str = "https://dashscope.aliyuncs.com/compatible-mode/v1"
    DEFAULT_LLM_API_KEY: str = ""
    DEFAULT_VISION_MODEL: str = "qwen3.5-ocr"
    DEFAULT_TRANSLATE_MODEL: str = "deepseek-v4.1-flash-1017"
    DEFAULT_CHAT_MODEL: str = "deepseek-v4.1-flash-1017"
    DEFAULT_CHAT_THINKING_LEVEL: str = "high"

    DATA_DIR: str = "./data"
    MAX_UPLOAD_MB: int = 60
    PDF_RENDER_DPI: int = 200

    model_config = {"env_file": ".env", "extra": "ignore"}

    @property
    def data_path(self) -> Path:
        return Path(self.DATA_DIR)

    @property
    def pdfs_dir(self) -> Path:
        return self.data_path / "pdfs"

    @property
    def figures_dir(self) -> Path:
        return self.data_path / "figures"

    @property
    def thumbnails_dir(self) -> Path:
        return self.data_path / "thumbnails"

    def ensure_dirs(self) -> None:
        self.pdfs_dir.mkdir(parents=True, exist_ok=True)
        self.figures_dir.mkdir(parents=True, exist_ok=True)
        self.thumbnails_dir.mkdir(parents=True, exist_ok=True)


settings = Settings()
settings.ensure_dirs()
