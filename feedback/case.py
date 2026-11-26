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

LOW_SCORE = 2
DROP_THRESHOLD = 1
PAIR_GAP_THRESHOLD = 1.5
ROLE_LABELS = {"intern": "стажёр", "mentor": "наставник"}


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


def _evidence(role: str, period: int, field: str, value) -> dict:
    return {"source": ROLE_LABELS[role], "period": period, "field": field, "value": value}


def _signals(periods: list[int], intern: dict[int, dict], mentor: dict[int, dict]) -> list[dict]:
    current = periods[-1]
    signals = []

    def add(signal_id, level, title, why, evidence):
        signals.append({"id": signal_id, "level": level, "title": title, "why": why,
                        "evidence": evidence})

    for role, answers, fields in (
        ("intern", intern, store.INTERN_SCORES),
        ("mentor", mentor, store.MENTOR_SCORES),
    ):
        if current not in answers:
            add(f"missing-{role}", "red", f"Пропуск опроса: {ROLE_LABELS[role]}",
                f"За месяц {current} анкета не получена.",
                [_evidence(role, current, "Анкета получена", False)])
            continue

        scores = _scores(answers[current], fields)
        low = [_evidence(role, current, field, value) for field, value in scores.items()
               if value <= LOW_SCORE]
        if low:
            add(f"low-{role}", "red", f"Низкая оценка: {', '.join(item['field'] for item in low)}",
                f"В месяце {current} есть оценки {LOW_SCORE} или ниже.", low)
        if scores:
            average = mean(scores.values())
            if average < 4:
                evidence = [_evidence(role, current, field, value) for field, value in scores.items()]
                add(f"average-{role}", "red" if average < 3 else "yellow",
                    f"Низкий средний балл: {ROLE_LABELS[role]}",
                    f"Среднее за месяц {current}: {average:.2f} из 5.", evidence)

        drops = []
        for field, value in scores.items():
            past = [_evidence(role, p, field, answers[p][field]) for p in periods[:-1]
                    if p in answers and pd.notna(answers[p].get(field))]
            if past:
                baseline = mean(item["value"] for item in past)
                if baseline - value >= DROP_THRESHOLD:
                    drops.append((field, baseline, value, past))
        for field, baseline, value, past in drops:
            level = "red" if len(drops) >= 2 or baseline - value >= 2 else "yellow"
            add(f"drop-{role}-{field}", level, f"Снижение: {field}",
                f"Оценка {value} за месяц {current}, личное среднее прошлых месяцев {baseline:.2f}.",
                [_evidence(role, current, field, value), *past])

    for intern_field, mentor_field in PAIRS:
        evidence_by_period = {}
        for p in range(max(1, current - 2), current + 1):
            left = intern.get(p, {}).get(intern_field)
            right = mentor.get(p, {}).get(mentor_field)
            if pd.notna(left) and pd.notna(right) and abs(left - right) >= PAIR_GAP_THRESHOLD:
                evidence_by_period[p] = [
                    _evidence("intern", p, intern_field, int(left)),
                    _evidence("mentor", p, mentor_field, int(right)),
                ]
        repeated = len(evidence_by_period) >= 2
        if current in evidence_by_period or repeated:
            if repeated:
                months = ", ".join(map(str, evidence_by_period))
                why = f"Расхождение в двух из трёх последних месяцев: {months}."
            else:
                left, right = evidence_by_period[current]
                why = f"Месяц {current}: стажёр {left['value']}, наставник {right['value']}."
            add(f"pair-{intern_field}", "red" if repeated else "yellow",
                f"Расхождение: {intern_field}", why,
                [item for pair in reversed(evidence_by_period.values()) for item in pair])

    return sorted(signals, key=lambda signal: signal["level"] != "red")


def build_intern(hist: store.History, intern_id: str, period: int | None = None) -> dict:
    """Return a single intern's survey history as of the selected period."""
    hist, periods, _ = _snapshot(hist, period)
    person = next((person for person in store.roster(hist) if person["intern_id"] == intern_id), None)
    if person is None:
        raise KeyError(intern_id)

    intern = _answers(hist.interns, intern_id)
    mentor = _answers(hist.mentors, intern_id)
    details = [_period_detail(p, intern.get(p, {}), mentor.get(p, {})) for p in periods]

    signals = _signals(periods, intern, mentor)
    return {
        **person,
        "status": signals[0]["level"] if signals else "green",
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
        "signals": signals,
        "summary": signals[0]["why"] if signals else "За выбранный месяц сигналов по анкетам нет.",
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
        signals = _signals(periods, intern, mentor)
        interns.append({
            **person,
            "status": signals[0]["level"] if signals else "green",
            "intern_avg": detail["intern_avg"],
            "mentor_avg": detail["mentor_avg"],
            "gap": detail["gap"],
            "trend": trend,
            "signals": len(signals),
            "reason": signals[0]["title"] if signals else "Сигналов по анкетам нет",
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
            **{level: sum(person["status"] == level for person in interns)
               for level in ("red", "yellow", "green")},
        },
    }
