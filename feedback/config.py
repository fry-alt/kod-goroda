"""Настройки из переменных окружения / .env."""
from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")


@dataclass(frozen=True)
class Settings:
    # auto: YandexGPT, если есть ключ Яндекса; иначе Claude, если есть его ключ; иначе офлайн-правила
    provider: str = os.getenv("LLM_PROVIDER", "auto")  # auto | yandex | claude | offline

    yandex_model: str = os.getenv("YANDEX_MODEL", "yandexgpt-5.1")

    claude_model: str = os.getenv("CLAUDE_MODEL", "claude-opus-5-5")
    claude_item_effort: str = os.getenv("CLAUDE_ITEM_EFFORT", "low")      # разметка — простая задача
    claude_report_effort: str = os.getenv("CLAUDE_REPORT_EFFORT", "high")  # итоговые выводы

    batch_size: int = int(os.getenv("BATCH_SIZE", "10"))
    workers: int = int(os.getenv("WORKERS", "4"))
    cache_dir: Path = Path(os.getenv("CACHE_DIR", str(ROOT / ".cache")))

    def engine(self) -> str:
        if self.provider != "auto":
            return self.provider
        if os.getenv("YC_API_KEY") and os.getenv("YC_FOLDER_ID"):
            return "yandex"
        if os.getenv("ANTHROPIC_API_KEY") or os.getenv("ANTHROPIC_AUTH_TOKEN"):
            return "claude"
        return "offline"

    def engine_label(self) -> str:
        e = self.engine()
        return {"yandex": f"YandexGPT · {self.yandex_model}", "claude": f"Claude · {self.claude_model}"}.get(
            e, "офлайн-правила")


settings = Settings()
