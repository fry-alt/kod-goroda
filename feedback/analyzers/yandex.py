"""Провайдер Yandex AI Studio (YandexGPT / Alice AI LLM) через yandex-ai-studio-sdk.

Нужны YC_API_KEY (API-ключ сервисного аккаунта с ролью ai.languageModels.user)
и YC_FOLDER_ID (ID каталога в Yandex Cloud). SDK сам читает их из окружения.
"""
from __future__ import annotations

import logging
from typing import Optional, TypeVar

from pydantic import BaseModel, ValidationError
from yandex_ai_studio_sdk import AIStudio

from ..config import settings
from .llm import inline_schema

log = logging.getLogger(__name__)
T = TypeVar("T", bound=BaseModel)


class YandexProvider:
    name = "yandex"

    def __init__(self) -> None:
        self.model = settings.yandex_model
        self.sdk = AIStudio()  # folder_id и auth берутся из YC_FOLDER_ID / YC_API_KEY

    def complete(self, system: str, user: str, schema: type[T], kind: str) -> Optional[T]:
        model = self.sdk.models.completions(self.model).configure(
            temperature=0.1 if kind == "item" else 0.3,
            max_tokens=8000,
            response_format={"json_schema": inline_schema(schema), "name": schema.__name__, "strict": True},
        )
        result = model.run([
            {"role": "system", "text": system},
            {"role": "user", "text": user},
        ])
        status = result.status.name
        if status not in ("FINAL", "TRUNCATED_FINAL"):
            log.warning("YandexGPT вернул статус %s", status)
            return None
        try:
            return schema.model_validate_json(result.text)
        except ValidationError as e:
            log.warning("YandexGPT вернул JSON не по схеме: %s", e.errors()[:3])
            return None
