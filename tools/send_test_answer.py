"""Запасной канал для демо: отправить тестовый ответ на вебхук, если форма или сеть упали.

  python tools/send_test_answer.py intern СТ-002 7 --scores 3,4,2,4,4,4,3 --text "Думаю уйти, не успеваю"
  python tools/send_test_answer.py mentor СТ-002 7 --scores 4,4,4,3,4,4 --text "Стал срывать сроки"
  python tools/send_test_answer.py demo            # готовый сценарий из ПЛАН.md: СТ-002, Месяц 7, ухудшение

Адрес — API_URL (по умолчанию http://localhost:8000), секрет — WEBHOOK_SECRET.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from feedback import store  # noqa: E402

DEMO = {
    "intern": ("СТ-002", 7, [3, 4, 2, 4, 4, 4, 3],
               ["Слишком много параллельных задач, не успеваю, задерживаюсь каждый день.",
                "Думаю уйти: нагрузка выше комфортной уже несколько недель."]),
    "mentor": ("СТ-002", 7, [4, 4, 4, 3, 4, 4],
               ["Качество хорошее, но часть сроков сорвана из-за большого объёма задач.",
                "Стоит снизить нагрузку."]),
}


def build(form: str, intern_id: str, period: int, scores: list[int], texts: list[str]) -> dict:
    spec = store.FORMS[form]
    ans = {store.INTERN_ID: intern_id, store.PERIOD_RAW: f"Месяц {period}"}
    ans.update(dict(zip(spec["scores"], scores)))
    ans.update(dict(zip(store.INTERN_TEXTS if form == "intern" else store.MENTOR_TEXTS, texts)))
    return ans


def send(form: str, answers: dict) -> dict:
    url = os.getenv("API_URL", "http://localhost:8000").rstrip("/") + f"/api/webhook/{form}"
    headers = {"X-Webhook-Secret": os.getenv("WEBHOOK_SECRET", "")}
    r = httpx.post(url, json={"answers": answers}, headers=headers, timeout=15)
    r.raise_for_status()
    return r.json()


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("form", choices=["intern", "mentor", "demo"])
    p.add_argument("intern_id", nargs="?")
    p.add_argument("period", nargs="?", type=int)
    p.add_argument("--scores", help="оценки через запятую в порядке анкеты (стажёр 7, наставник 6)")
    p.add_argument("--text", action="append", default=[], help="комментарий (можно 2 раза)")
    a = p.parse_args()
    if a.form == "demo":
        for form in ("intern", "mentor"):
            sid, per, sc, tx = DEMO[form]
            print(form, json.dumps(send(form, build(form, sid, per, sc, tx)), ensure_ascii=False))
        return
    if not (a.intern_id and a.period and a.scores):
        p.error("нужны intern_id, period и --scores")
    scores = [int(x) for x in a.scores.split(",")]
    need = len(store.FORMS[a.form]["scores"])
    if len(scores) != need:
        p.error(f"нужно {need} оценок, а передано {len(scores)}")
    print(json.dumps(send(a.form, build(a.form, a.intern_id, a.period, scores, a.text)), ensure_ascii=False))


if __name__ == "__main__":
    main()
