"""Провайдер Claude API (структурированный вывод в pydantic-схему).

Нужен ANTHROPIC_API_KEY.
"""
from __future__ import annotations

import logging
from typing import Optional, TypeVar

import anthropic
from pydantic import BaseModel

from ..config import settings

log = logging.getLogger(__name__)
T = TypeVar("T", bound=BaseModel)


class ClaudeProvider:
    name = "claude"

    def __init__(self) -> None:
        self.model = settings.claude_model
        self.client = anthropic.Anthropic(max_retries=4)

    def complete(self, system: str, user: str, schema: type[T], kind: str) -> Optional[T]:
        effort = settings.claude_item_effort if kind == "item" else settings.claude_report_effort
        response = self.client.messages.parse(
            model=self.model,
            max_tokens=16000,
            system=system,
            output_config={"effort": effort},
            output_format=schema,
            messages=[{"role": "user", "content": user}],
        )
        if response.stop_reason == "refusal":
            log.warning("Claude отказался отвечать (%s)", response.stop_details)
            return None
        return response.parsed_output
