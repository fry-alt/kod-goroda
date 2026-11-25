"""Офлайн-анализатор на правилах: работает без ключа и интернета.

Нужен, чтобы демо и тесты жили без API, и как запасной вариант при сбоях.
Качество заметно ниже, чем у LLM.
"""
from __future__ import annotations

import re

from ..schemas import FeedbackItem, ItemAnalysis, Sentiment, Urgency
from ..taxonomy import TOPICS

POS = ["отлично", "хорош", "нравит", "спасибо", "полезн", "интересн", "помог", "супер", "классн",
       "доволен", "довольна", "понятн", "поддерж", "рекоменд", "лучш", "вырос", "научил", "молодец", "быстро учится"]
NEG = ["плохо", "ужас", "не нрав", "скучн", "игнор", "не отвеча", "груб", "непонятн", "хаос", "перераб",
       "устал", "выгор", "токсич", "не хватает", "проблем", "долго", "никто", "не помог", "бесполезн",
       "разочаров", "уйти", "уволь", "завал", "не успева", "ошибк"]
CHURN = ["уйти", "уволь", "уход", "ищу другую", "искать другую", "ищу работу", "другого наставника", "не вижу смысла", "выгор", "брошу", "не останусь"]
HIGH = CHURN + ["груб", "оскорб", "токсич", "унижа", "домогат", "угрож", "не платят", "задерживают оплату"]
SUGGEST = re.compile(r"(?:хотел(?:ось)?(?: бы)?|было бы (?:здорово|хорошо|круто)|предлагаю|стоит|нужно|надо|лучше бы)\s+([^.!?\n]+)", re.I)
SENT_SPLIT = re.compile(r"(?<=[.!?])\s+")


def _count(text: str, words: list[str]) -> int:
    return sum(text.count(w) for w in words)


def analyze_item(item: FeedbackItem) -> ItemAnalysis:
    t = item.text.lower()
    pos, neg = _count(t, POS), _count(t, NEG)
    total = pos + neg
    score = 0.0 if total == 0 else round((pos - neg) / total, 2)
    if item.rating is not None:  # если есть исходная оценка — подмешиваем (шкала 1–5 или 1–10)
        scale = 10 if item.rating > 5 else 5
        score = round(0.5 * score + 0.5 * ((item.rating - 1) / (scale - 1) * 2 - 1), 2)

    if pos and neg and abs(pos - neg) <= 1:
        sentiment = Sentiment.mixed
    elif score > 0.2:
        sentiment = Sentiment.positive
    elif score < -0.2:
        sentiment = Sentiment.negative
    else:
        sentiment = Sentiment.neutral

    topics = [code for code, info in TOPICS.items() if any(k in t for k in info["keywords"])]
    sentences = SENT_SPLIT.split(item.text.strip())
    problems = [s.strip() for s in sentences if any(w in s.lower() for w in NEG)][:3]
    suggestions = [m.group(1).strip() for m in SUGGEST.finditer(item.text)][:3]
    churn = any(w in t for w in CHURN)
    if any(w in t for w in HIGH):
        urgency = Urgency.high
    elif sentiment in (Sentiment.negative, Sentiment.mixed):
        urgency = Urgency.medium
    else:
        urgency = Urgency.low

    return ItemAnalysis(
        id=item.id,
        sentiment=sentiment,
        sentiment_score=score,
        topics=topics,
        problems=problems,
        suggestions=suggestions,
        urgency=urgency,
        churn_risk=churn,
        summary=sentences[0][:200] if sentences else "",
    )


def analyze(items: list[FeedbackItem]) -> list[ItemAnalysis]:
    return [analyze_item(i) for i in items]
