"""Приём ответов (вебхук, CSV-опрос, тестовый скрипт) и вызов анализа.

Анализ пишет Савелий в feedback/case.py: build_overview(hist, period) и build_intern(hist, intern_id, period).
Пока его модуля нет, отдаём «сырые» данные в форме контракта без сигналов (FALLBACK), чтобы фронт и
сквозной сценарий работали уже сейчас.
"""
from __future__ import annotations

import logging
from typing import Optional

from feedback import ingest, store

log = logging.getLogger("api")


def ingest_answer(form: Optional[str], answers: dict, via: str) -> dict:
    form = form or ingest.guess_form(answers)
    if form not in store.FORMS:
        raise ValueError(f"неизвестная форма {form!r}: нужна intern или mentor")
    row = ingest.parse_form_answer(form, answers)
    intern_id = row.get(store.INTERN_ID)
    if intern_id:  # подставляем подразделение и наставника из истории, если форма их не спросила
        known = {p["intern_id"]: p for p in store.roster(store.load_history())}.get(intern_id)
        if known:
            row.setdefault(store.DEPT, known["department"])
            if form == "mentor":
                row.setdefault(store.MENTOR_ID, known["mentor_id"])
    res = store.upsert(form, row, source=via)
    log.info("ответ %s: %s, Месяц %s, %s", via, res["intern_id"], res["period"],
             "записан" if res["changed"] else "без изменений")
    return res


# ---------- анализ ----------

try:
    from feedback.case import build_intern as _build_intern  # noqa: F401
    from feedback.case import build_overview as _build_overview  # noqa: F401
    ANALYSIS = "feedback.case"
except ImportError:
    _build_overview = _build_intern = None
    ANALYSIS = "fallback"


def _avg(d: dict):
    vals = [v for v in d.values() if v is not None]
    return round(sum(vals) / len(vals), 1) if vals else None


def _fallback_intern(hist: store.History, intern_id: str) -> dict:
    ii = hist.interns[hist.interns[store.INTERN_ID] == intern_id].set_index("period")
    mm = hist.mentors[hist.mentors[store.INTERN_ID] == intern_id].set_index("period")
    who = {p["intern_id"]: p for p in store.roster(hist)}.get(intern_id)
    if who is None:
        raise KeyError(intern_id)
    periods = []
    for p in sorted(set(ii.index) | set(mm.index)):
        iv = {c: int(ii.loc[p, c]) for c in store.INTERN_SCORES} if p in ii.index else {}
        mv = {c: int(mm.loc[p, c]) for c in store.MENTOR_SCORES} if p in mm.index else {}
        ia, ma = _avg(iv), _avg(mv)
        periods.append({
            "period": int(p), "intern": iv, "mentor": mv, "intern_avg": ia, "mentor_avg": ma,
            "gap": round(ia - ma, 1) if ia is not None and ma is not None else None,
            "comments": {"intern": {c: ii.loc[p, c] for c in store.INTERN_TEXTS} if p in ii.index else {},
                         "mentor": {c: mm.loc[p, c] for c in store.MENTOR_TEXTS} if p in mm.index else {}},
            "comment_analysis": {"topics": [], "tone": "—", "risk": False},
        })
    return {**who, "status": "green", "periods": periods, "pairs": [], "signals": [],
            "summary": "Модуль анализа ещё не подключён (feedback/case.py).", "actions": []}


def _fallback_overview(hist: store.History) -> dict:
    people = store.roster(hist)
    all_periods = sorted(set(hist.interns["period"]) | set(hist.mentors["period"]))
    cur = max(all_periods) if all_periods else None
    have_i = set(zip(hist.interns[store.INTERN_ID], hist.interns["period"]))
    have_m = set(zip(hist.mentors[store.INTERN_ID], hist.mentors["period"]))
    survey, interns = [], []
    for p in people:
        sid = p["intern_id"]
        survey.append({**p, "periods": {str(k): {"intern": (sid, k) in have_i, "mentor": (sid, k) in have_m}
                                        for k in all_periods}})
        card = _fallback_intern(hist, sid)
        last = card["periods"][-1] if card["periods"] else {}
        interns.append({**p, "status": "green", "intern_avg": last.get("intern_avg"),
                        "mentor_avg": last.get("mentor_avg"), "gap": last.get("gap"), "trend": None,
                        "signals": 0, "reason": "анализ не подключён"})
    return {"periods": [int(x) for x in all_periods], "current_period": int(cur) if cur else None,
            "survey_status": survey, "interns": interns,
            "kpi": {"responded_interns": f"{sum((s['intern_id'], cur) in have_i for s in people)}/{len(people)}",
                    "responded_mentors": f"{sum((s['intern_id'], cur) in have_m for s in people)}/{len(people)}",
                    "red": 0, "yellow": 0, "green": len(people)}}


def overview(period: Optional[int] = None) -> dict:
    hist = store.load_history(period)
    out = _build_overview(hist, period) if _build_overview else _fallback_overview(hist)
    out["version"] = store.get_version()["version"]
    out["analysis"] = ANALYSIS
    return out


def intern(intern_id: str, period: Optional[int] = None) -> dict:
    hist = store.load_history(period)
    if _build_intern:
        return _build_intern(hist, intern_id, period)
    return _fallback_intern(hist, intern_id)
