"""Build dashboard data from the internship survey history."""

from __future__ import annotations

from statistics import mean

import pandas as pd

from . import store

PAIRS = (
    ("Понятность задач", "Понимание задач и ожиданий"),
    ("Взаимодействие с командой", "Взаимодействие с наставником и командой"),
    ("Интерес к задачам", "Вовлеченность и инициативность"),
    ("Поддержка и обратная связь наставника", "Взаимодействие с наставником и командой"),
)

ANALYSIS_PENDING = "Сигналы пока не рассчитываются."


def _snapshot(hist: store.History, period: int | None) -> tuple[store.History, list[int], int | None]:
    if period is not None:
        hist = store.History(
            hist.interns[hist.interns["period"] <= period],
            hist.mentors[hist.mentors["period"] <= period],
        )
    periods = sorted({int(p) for frame in (hist.interns, hist.mentors) for p in frame["period"]})
    if period is not None and period not in periods:
        periods.append(period)
    return hist, periods, max(periods, default=None)


def _answers(frame: pd.DataFrame, intern_id: str) -> dict[int, dict]:
    rows = frame[frame[store.INTERN_ID] == intern_id].to_dict("records")
    return {int(row["period"]): row for row in rows}


def _scores(row: dict, fields: list[str]) -> dict:
    return {field: int(row[field]) for field in fields if pd.notna(row.get(field))}


def _comments(row: dict, fields: list[str]) -> dict:
    return {field: str(row[field]) for field in fields if pd.notna(row.get(field))}


def _rounded(value: float | None) -> float | None:
    return None if value is None else round(value, 1)


def _difference(left: float | None, right: float | None) -> float | None:
    return None if left is None or right is None else _rounded(left - right)


def _period_detail(period: int | None, intern: dict, mentor: dict) -> dict:
    intern_scores = _scores(intern, store.INTERN_SCORES)
    mentor_scores = _scores(mentor, store.MENTOR_SCORES)
    intern_avg = mean(intern_scores.values()) if intern_scores else None
    mentor_avg = mean(mentor_scores.values()) if mentor_scores else None
    return {
        "period": period,
        "intern": intern_scores,
        "mentor": mentor_scores,
        "intern_avg": _rounded(intern_avg),
        "mentor_avg": _rounded(mentor_avg),
        "gap": _difference(intern_avg, mentor_avg),
        "comments": {
            "intern": _comments(intern, store.INTERN_TEXTS),
            "mentor": _comments(mentor, store.MENTOR_TEXTS),
        },
        "comment_analysis": {"topics": [], "tone": "—", "risk": False},
    }


def build_intern(hist: store.History, intern_id: str, period: int | None = None) -> dict:
    """Return a single intern's survey history as of the selected period."""
    hist, periods, _ = _snapshot(hist, period)
    person = next((person for person in store.roster(hist) if person["intern_id"] == intern_id), None)
    if person is None:
        raise KeyError(intern_id)

    intern = _answers(hist.interns, intern_id)
    mentor = _answers(hist.mentors, intern_id)
    details = [_period_detail(p, intern.get(p, {}), mentor.get(p, {})) for p in periods]

    return {
        **person,
        "status": "green",
        "periods": details,
        "pairs": [
            {
                "intern": intern_field,
                "mentor": mentor_field,
                "by_period": [
                    [detail["intern"].get(intern_field), detail["mentor"].get(mentor_field)]
                    for detail in details
                ],
            }
            for intern_field, mentor_field in PAIRS
        ],
        "signals": [],
        "summary": ANALYSIS_PENDING,
        "actions": [],
    }


def build_overview(hist: store.History, period: int | None = None) -> dict:
    """Return survey completion and score summaries for the selected period."""
    hist, periods, current = _snapshot(hist, period)

    survey_status, interns = [], []
    for person in store.roster(hist):
        intern_id = person["intern_id"]
        intern = _answers(hist.interns, intern_id)
        mentor = _answers(hist.mentors, intern_id)
        survey_status.append({
            **person,
            "periods": {str(p): {"intern": p in intern, "mentor": p in mentor} for p in periods},
        })
        detail = _period_detail(current, intern.get(current, {}), mentor.get(current, {}))
        first_scores = _scores(intern[min(intern)], store.INTERN_SCORES) if intern else {}
        current_scores = detail["intern"]
        trend = (
            _difference(mean(current_scores.values()), mean(first_scores.values()))
            if first_scores and current_scores else None
        )
        interns.append({
            **person,
            "status": "green",
            "intern_avg": detail["intern_avg"],
            "mentor_avg": detail["mentor_avg"],
            "gap": detail["gap"],
            "trend": trend,
            "signals": 0,
            "reason": ANALYSIS_PENDING,
        })

    totals = {
        role: sum(entry["periods"][str(current)][role] for entry in survey_status)
        for role in ("intern", "mentor")
    }
    return {
        "periods": periods,
        "current_period": current,
        "survey_status": survey_status,
        "interns": interns,
        "kpi": {
            "responded_interns": f"{totals['intern']}/{len(interns)}",
            "responded_mentors": f"{totals['mentor']}/{len(interns)}",
            "red": 0,
            "yellow": 0,
            "green": len(interns),
        },
    }
