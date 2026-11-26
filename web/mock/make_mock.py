# -*- coding: utf-8 -*-
"""Моки для фронта по API-контракту из CLAUDE.md, посчитанные из реальных xlsx кейса.
Логика здесь упрощённая (только чтобы фронт верстался на настоящих числах) — боевую считает бэк.
Запуск: uv run --with pandas --with openpyxl python web/mock/make_mock.py [N]  → web/mock/pN/
"""
import json
import sys
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
OUT = Path(__file__).parent
I = pd.read_excel(ROOT / "data/case/Ответы стажеров.xlsx")
M = pd.read_excel(ROOT / "data/case/Оценки наставников.xlsx")
for d in (I, M):
    d["period"] = d["Контрольный период"].str.extract(r"(\d+)").astype(int)
CUT = int(sys.argv[1]) if len(sys.argv) > 1 else 6  # «как дашборд выглядел на Месяц N»
I, M = I[I.period <= CUT], M[M.period <= CUT]
OUT = OUT / f"p{CUT}"
OUT.mkdir(exist_ok=True)

I_SC = ["Понятность задач", "Поддержка и обратная связь наставника", "Комфортность нагрузки", "Интерес к задачам",
        "Профессиональное развитие", "Взаимодействие с командой", "Общая удовлетворенность стажировкой"]
M_SC = ["Понимание задач и ожиданий", "Качество выполнения задач", "Самостоятельность",
        "Соблюдение сроков и организация работы", "Вовлеченность и инициативность",
        "Взаимодействие с наставником и командой"]
I_TX = ["Сложности за период", "Что мешает работать и развиваться"]
M_TX = ["Комментарий о работе за период", "Сложности / ситуации для внимания"]
PAIRS = [("Понятность задач", "Понимание задач и ожиданий"),
         ("Взаимодействие с командой", "Взаимодействие с наставником и командой"),
         ("Интерес к задачам", "Вовлеченность и инициативность"),
         ("Поддержка и обратная связь наставника", "Взаимодействие с наставником и командой")]
RISK = ["уйти", "уход", "увол", "выгора", "не успева", "перегруж", "нет обратной", "не понима", "конфликт",
        "демотив", "не хватает", "задерж", "устал", "сниж", "пропуск", "не отвеча"]
PERIODS = sorted(set(I.period) | set(M.period))
r1 = lambda x: None if x is None or pd.isna(x) else round(float(x), 1)  # noqa: E731


def risk_words(text):
    t = str(text or "").lower()
    return [w for w in RISK if w in t]


overview, survey, cards = [], [], {}
for sid in sorted(I["ID стажера"].unique()):
    ii = I[I["ID стажера"] == sid].set_index("period").sort_index()
    mm = M[M["ID стажера"] == sid].set_index("period").sort_index()
    mid = mm["ID наставника"].iloc[0] if len(mm) else None
    dep = ii["Подразделение / направление стажировки"].iloc[0]
    survey.append({"intern_id": sid, "mentor_id": mid, "department": dep,
                   "periods": {str(p): {"intern": p in ii.index, "mentor": p in mm.index} for p in PERIODS}})
    periods, signals = [], []
    for p in PERIODS:
        iv = {c: int(ii.loc[p, c]) for c in I_SC} if p in ii.index else {}
        mv = {c: int(mm.loc[p, c]) for c in M_SC} if p in mm.index else {}
        ia = sum(iv.values()) / len(iv) if iv else None
        ma = sum(mv.values()) / len(mv) if mv else None
        ic = {c: str(ii.loc[p, c]) for c in I_TX} if p in ii.index else {}
        mc = {c: str(mm.loc[p, c]) for c in M_TX} if p in mm.index else {}
        hits = sorted({w for t in list(ic.values()) + list(mc.values()) for w in risk_words(t)})
        periods.append({"period": p, "intern": iv, "mentor": mv, "intern_avg": r1(ia), "mentor_avg": r1(ma),
                        "gap": r1(ia - ma) if ia is not None and ma is not None else None,
                        "comments": {"intern": ic, "mentor": mc},
                        "comment_analysis": {"topics": hits, "tone": "негатив" if hits else "нейтрально/позитив",
                                             "risk": bool(hits)}})
    # упрощённые сигналы: падение к норме первых 3 месяцев, разрыв пары, слова риска в последних 2 периодах
    norm = {c: ii.loc[ii.index <= 3, c].mean() for c in I_SC}
    last = ii.index.max()
    for c in I_SC:
        if norm[c] - ii.loc[last, c] >= 1:
            signals.append({"id": f"{sid}-drop-{c}", "level": "red" if norm[c] - ii.loc[last, c] >= 2 else "yellow",
                            "title": f"Падение: {c}", "why": f"{r1(norm[c])} в месяцы 1–3 → {int(ii.loc[last, c])} в месяц {last}",
                            "evidence": [{"source": "стажёр", "period": int(p), "field": c, "value": int(ii.loc[p, c])}
                                         for p in ii.index]})
    for a, b in PAIRS:
        gaps = [(p, int(ii.loc[p, a]) - int(mm.loc[p, b])) for p in PERIODS if p in ii.index and p in mm.index]
        big = [g for g in gaps[-3:] if abs(g[1]) >= 2]
        if len(big) >= 2:
            signals.append({"id": f"{sid}-gap-{a}", "level": "yellow", "title": f"Расхождение: {a} ↔ {b}",
                            "why": "стажёр и наставник оценивают по-разному 2 из 3 последних месяцев",
                            "evidence": [{"source": "стажёр/наставник", "period": int(p), "field": f"{a} − {b}", "value": g}
                                         for p, g in gaps]})
    for pr in periods[-2:]:
        if pr["comment_analysis"]["risk"]:
            q = next((t for t in list(pr["comments"]["intern"].values()) + list(pr["comments"]["mentor"].values())
                      if risk_words(t)), "")
            signals.append({"id": f"{sid}-txt-{pr['period']}", "level": "yellow", "title": "Тревожный комментарий",
                            "why": "в тексте: " + ", ".join(pr["comment_analysis"]["topics"]),
                            "evidence": [{"source": "комментарий", "period": pr["period"], "field": "текст", "quote": q}]})
    missed = [p for p in PERIODS if p not in ii.index or p not in mm.index]
    if missed:
        signals.append({"id": f"{sid}-miss", "level": "red", "title": "Пропуск опроса",
                        "why": "нет анкеты в периодах " + ", ".join(map(str, missed)), "evidence": []})
    reds = sum(s["level"] == "red" for s in signals)
    status = "red" if reds or len(signals) >= 3 else "yellow" if signals else "green"
    lp = periods[-1]
    trend = r1((lp["intern_avg"] or 0) - (periods[0]["intern_avg"] or 0))
    card = {"intern_id": sid, "mentor_id": mid, "department": dep, "status": status, "periods": periods,
            "pairs": [{"intern": a, "mentor": b, "by_period": [[p["intern"].get(a), p["mentor"].get(b)] for p in periods]}
                      for a, b in PAIRS],
            "signals": signals,
            "summary": ("Сигналов нет, динамика стабильная." if not signals else
                        f"{len(signals)} сигн.: " + "; ".join(s["title"] for s in signals[:3]) + "."),
            "actions": [] if not signals else ["Провести встречу HR со стажёром", "Обсудить с наставником " + str(mid)]}
    cards[sid] = card
    overview.append({"intern_id": sid, "mentor_id": mid, "department": dep, "status": status,
                     "intern_avg": lp["intern_avg"], "mentor_avg": lp["mentor_avg"], "gap": lp["gap"], "trend": trend,
                     "signals": len(signals), "reason": signals[0]["title"] if signals else "без сигналов"})

cur = max(PERIODS)
ov = {"periods": PERIODS, "current_period": cur, "survey_status": survey, "interns": overview,
      "kpi": {"responded_interns": f"{sum(s['periods'][str(cur)]['intern'] for s in survey)}/{len(survey)}",
              "responded_mentors": f"{sum(s['periods'][str(cur)]['mentor'] for s in survey)}/{len(survey)}",
              **{k: sum(o["status"] == k for o in overview) for k in ("red", "yellow", "green")}},
      "version": 1}
(OUT / "overview.json").write_text(json.dumps(ov, ensure_ascii=False, indent=1), encoding="utf-8")
for sid, c in cards.items():
    (OUT / f"intern_{sid}.json").write_text(json.dumps(c, ensure_ascii=False, indent=1), encoding="utf-8")
(OUT / "version.json").write_text(json.dumps({"version": 1, "last_event": None}), encoding="utf-8")
for o in overview:
    print(o["intern_id"], o["department"], o["status"], o["signals"], "|", o["reason"])
print("kpi", ov["kpi"])
