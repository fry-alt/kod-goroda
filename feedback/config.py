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
    # auto: Claude, если есть ключ, иначе офлайн-эвристики
    provider: str = os.getenv("LLM_PROVIDER", "auto")           # auto | claude | offline
    model: str = os.getenv("CLAUDE_MODEL", "claude-opus-5-5")
    item_effort: str = os.getenv("CLAUDE_ITEM_EFFORT", "low")    # разметка отзывов — простая задача
    report_effort: str = os.getenv("CLAUDE_REPORT_EFFORT", "high")  # итоговые выводы
    batch_size: int = int(os.getenv("BATCH_SIZE", "15"))
    workers: int = int(os.getenv("WORKERS", "4"))
    cache_dir: Path = Path(os.getenv("CACHE_DIR", str(ROOT / ".cache")))

    def use_claude(self) -> bool:
        if self.provider == "offline":
            return False
        if self.provider == "claude":
            return True
        return bool(os.getenv("ANTHROPIC_API_KEY") or os.getenv("ANTHROPIC_AUTH_TOKEN"))


settings = Settings()
