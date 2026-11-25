"""Точка входа анализа: загрузка → разметка → агрегация → выводы."""
from __future__ import annotations

import logging
from dataclasses import dataclass

import pandas as pd

from . import aggregate
from .analyzers import offline
from .config import settings
from .schemas import FeedbackItem, Insights
from .taxonomy import title

log = logging.getLogger(__name__)


@dataclass
class Result:
    df: pd.DataFrame
    stats: dict
    insights: Insights
    engine: str  # "claude" | "offline"

    @property
    def alerts(self) -> pd.DataFrame:
        return aggregate.alerts(self.df)


def _offline_insights(s: dict) -> Insights:
    neg = s["sentiment"].get("negative", 0)
    worst_topics = sorted((t for t in s["topics"] if t["n"] >= 2), key=lambda t: t["avg_score"])[:3]
    findings = [
        f"Всего отзывов: {s['total']}, средняя тональность {s['avg_score']:+.2f}, негативных {neg}.",
        *[f"Тема «{t['title']}»: {t['n']} упоминаний, средняя тональность {t['avg_score']:+.2f}." for t in worst_topics],
    ]
    risks = []
    if s["churn_risk"]:
        risks.append(f"{s['churn_risk']} отзывов с признаками риска ухода стажёра.")
    if s["high_urgency"]:
        risks.append(f"{s['high_urgency']} отзывов требуют срочной реакции HR.")
    risks += [f"Наставник «{m['subject']}»: средняя тональность {m['avg_score']:+.2f} ({m['n']} отз.)"
              for m in s["mentors"][:3] if m["avg_score"] < 0]
    recs = [f"Разобрать проблемы по теме «{t['title']}»." for t in worst_topics if t["avg_score"] < 0]
    if s["churn_risk"]:
        recs.append("Провести 1:1 со стажёрами из списка риска ухода в течение недели.")
    return Insights(
        headline=f"Проанализировано {s['total']} отзывов (офлайн-режим, без LLM)",
        key_findings=findings,
        risks=risks or ["Явных рисков не обнаружено."],
        recommendations=recs or ["Продолжать регулярный сбор обратной связи."],
    )


def run(items: list[FeedbackItem], with_insights: bool = True) -> Result:
    if settings.use_claude():
        from .analyzers import claude
        engine = "claude"
        analyses = claude.analyze(items)
    else:
        engine = "offline"
        analyses = offline.analyze(items)

    df = aggregate.to_frame(items, analyses)
    s = aggregate.stats(df)
    ins = None
    if with_insights and engine == "claude":
        ins = claude.insights(s)
    return Result(df=df, stats=s, insights=ins or _offline_insights(s), engine=engine)


__all__ = ["run", "Result", "title"]
