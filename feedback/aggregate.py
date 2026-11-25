"""Сводная статистика по размеченным отзывам (pandas)."""
from __future__ import annotations

import pandas as pd

from .schemas import FeedbackItem, ItemAnalysis
from .taxonomy import title


def to_frame(items: list[FeedbackItem], analyses: list[ItemAnalysis]) -> pd.DataFrame:
    by_id = {a.id: a for a in analyses}
    rows = []
    for it in items:
        a = by_id[it.id]
        rows.append({
            "id": it.id,
            "text": it.text,
            "role": it.role.value,
            "author": it.author,
            "subject": it.subject,
            "department": it.department,
            "date": pd.to_datetime(it.date) if it.date else pd.NaT,
            "rating": it.rating,
            "sentiment": a.sentiment.value,
            "score": a.sentiment_score,
            "topics": a.topics,
            "problems": a.problems,
            "suggestions": a.suggestions,
            "urgency": a.urgency.value,
            "churn_risk": a.churn_risk,
            "summary": a.summary,
        })
    return pd.DataFrame(rows)


def _group_score(df: pd.DataFrame, col: str, min_n: int = 1) -> list[dict]:
    if df[col].isna().all():
        return []
    g = df.dropna(subset=[col]).groupby(col).agg(
        n=("id", "count"),
        avg_score=("score", "mean"),
        negative_share=("sentiment", lambda s: (s == "negative").mean()),
        high_urgency=("urgency", lambda s: (s == "high").sum()),
    )
    g = g[g["n"] >= min_n].sort_values("avg_score")
    return g.round(2).reset_index().to_dict("records")


def stats(df: pd.DataFrame) -> dict:
    topics = df.explode("topics").dropna(subset=["topics"])
    topic_stats = (
        topics.groupby("topics")
        .agg(n=("id", "count"), avg_score=("score", "mean"))
        .sort_values("n", ascending=False)
        .round(2)
        .reset_index()
        .rename(columns={"topics": "topic"})
    )
    topic_stats["title"] = topic_stats["topic"].map(title)

    problems = df.explode("problems").dropna(subset=["problems"])
    timeline = []
    if df["date"].notna().any():
        t = df.dropna(subset=["date"]).set_index("date").resample("W")["score"].agg(["mean", "count"])
        timeline = [{"week": i.date().isoformat(), "avg_score": round(r["mean"], 2), "n": int(r["count"])}
                    for i, r in t.iterrows() if r["count"]]

    return {
        "total": int(len(df)),
        "by_role": df["role"].value_counts().to_dict(),
        "sentiment": df["sentiment"].value_counts().to_dict(),
        "avg_score": round(float(df["score"].mean()), 2) if len(df) else 0.0,
        "high_urgency": int((df["urgency"] == "high").sum()),
        "churn_risk": int(df["churn_risk"].sum()),
        "topics": topic_stats.to_dict("records"),
        "departments": _group_score(df, "department"),
        # о ком пишут стажёры = наставники; сортировка от худших
        "mentors": _group_score(df[df["role"] == "intern"], "subject"),
        "interns": _group_score(df[df["role"] == "mentor"], "subject"),
        "timeline": timeline,
        "sample_problems": problems["problems"].head(40).tolist(),
        "sample_suggestions": df.explode("suggestions").dropna(subset=["suggestions"])["suggestions"].head(30).tolist(),
    }


def alerts(df: pd.DataFrame) -> pd.DataFrame:
    """Отзывы, на которые HR стоит отреагировать в первую очередь."""
    mask = (df["urgency"] == "high") | df["churn_risk"]
    return df[mask].sort_values("score")[["id", "role", "author", "subject", "department", "urgency",
                                          "churn_risk", "score", "summary", "text"]]
