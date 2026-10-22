from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Barcha sozlamalar muhit o'zgaruvchilaridan (.env) olinadi."""

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # Telegram
    bot_token: str = ""
    bot_username: str = ""

    # Ma'lumotlar bazasi va Redis
    database_url: str = "postgresql+asyncpg://avtowebinar:avtowebinar@localhost:5432/avtowebinar"
    redis_url: str = "redis://localhost:6379/0"

    # Manzillar: o'z domeniga o'tish faqat shu ikki qiymatni almashtirish bilan qilinadi
    miniapp_url: str = "https://app.example.duckdns.org"
    admin_url: str = "https://admin.example.duckdns.org"

    # Admin panel
    jwt_secret: str = "change-me"
    jwt_ttl_hours: int = 12
    initial_admin_login: str = "admin"
    initial_admin_password: str = ""

    # Video (Bunny Stream)
    bunny_cdn_host: str = ""          # masalan vz-xxxx.b-cdn.net
    bunny_token_key: str = ""         # Pull zone > Security > Token authentication key
    video_url_ttl_sec: int = 4 * 3600

    # Fayllar (cheklar, media)
    storage_dir: str = "/data/storage"

    # Mini App initData yaroqlilik muddati
    initdata_max_age_sec: int = 24 * 3600

    # Yuborish tezligi (Telegram: ~30 xabar/soniya umumiy)
    send_rate_per_sec: float = 25.0

    timezone: str = "Asia/Tashkent"


@lru_cache
def get_settings() -> Settings:
    return Settings()
