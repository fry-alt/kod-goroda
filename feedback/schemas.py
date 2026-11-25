"""Модели данных: что приходит на вход и что выдаёт анализ."""
from __future__ import annotations

import datetime as dt
from enum import Enum
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field


class Role(str, Enum):
    intern = "intern"   # стажёр пишет о наставнике / стажировке
    mentor = "mentor"   # наставник пишет о стажёре
    unknown = "unknown"


class Sentiment(str, Enum):
    positive = "positive"
    neutral = "neutral"
    negative = "negative"
    mixed = "mixed"


class Urgency(str, Enum):
    low = "low"
    medium = "medium"
    high = "high"   # нужна реакция HR: риск ухода, конфликт, нарушение


class FeedbackItem(BaseModel):
    """Один отзыв после нормализации входного файла."""

    id: str
    text: str
    role: Role = Role.unknown
    author: Optional[str] = None
    subject: Optional[str] = None       # о ком отзыв (наставник / стажёр)
    department: Optional[str] = None
    date: Optional[dt.date] = None
    rating: Optional[float] = None      # исходная оценка, если есть (1–5, 1–10 …)
    extra: dict = Field(default_factory=dict)


class ItemAnalysis(BaseModel):
    """Результат анализа одного отзыва. Схема же уходит в LLM как формат ответа."""

    model_config = ConfigDict(extra="forbid")

    id: str
    sentiment: Sentiment
    sentiment_score: float = Field(description="от -1 (резко негативно) до 1 (резко позитивно)")
    topics: list[str] = Field(description="коды тем из таксономии")
    problems: list[str] = Field(description="конкретные проблемы, коротко, своими словами")
    suggestions: list[str] = Field(description="предложения автора или очевидные действия")
    urgency: Urgency
    churn_risk: bool = Field(description="есть признаки, что стажёр может уйти / выгореть")
    summary: str = Field(description="одно предложение — суть отзыва")


class BatchAnalysis(BaseModel):
    model_config = ConfigDict(extra="forbid")

    items: list[ItemAnalysis]


class Insights(BaseModel):
    """Итоговый отчёт по всей выборке."""

    model_config = ConfigDict(extra="forbid")

    headline: str
    key_findings: list[str]
    risks: list[str]
    recommendations: list[str]
