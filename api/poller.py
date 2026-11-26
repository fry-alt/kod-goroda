"""Опрос таблиц ответов Google Forms (опубликованный CSV) раз в POLL_SECONDS.

В Google Таблице ответов: Файл → Поделиться → Опубликовать в интернете → лист ответов → CSV.
Ссылки положить в .env: SHEET_CSV_INTERN=..., SHEET_CSV_MENTOR=...
Каждая строка CSV проходит тот же разбор, что и вебхук; одинаковые строки версию не меняют.
"""
from __future__ import annotations

import datetime as dt
import io
import logging
import os
import threading

import httpx
import pandas as pd

from feedback import store

from . import service

log = logging.getLogger("api.poller")


def sources() -> dict[str, str]:
    return {form: url for form, url in (("intern", os.getenv("SHEET_CSV_INTERN", "")),
                                        ("mentor", os.getenv("SHEET_CSV_MENTOR", ""))) if url}


STAMP = "Отметка времени"
STAMP_FORMATS = ("%d.%m.%Y %H:%M:%S", "%d.%m.%Y %H:%M", "%m/%d/%Y %H:%M:%S", "%Y-%m-%d %H:%M:%S")


def _stamp(value) -> dt.datetime | None:
    for fmt in STAMP_FORMATS:
        try:
            return dt.datetime.strptime(str(value).strip(), fmt)
        except ValueError:
            continue
    return None


def is_stale(rec: dict, since: dt.datetime | None) -> bool:
    """Строка отправлена до последнего `python -m feedback.store --reset` — это ответ с репетиции."""
    if since is None:
        return False
    at = _stamp(rec.get(STAMP))
    return at is not None and at < since  # непонятную отметку не выбрасываем: лучше принять, чем потерять ответ


def poll_once(client: httpx.Client) -> int:
    changed = 0
    # SHEET_SINCE — для облака: там база каждый раз новая, и без отсечки в неё попали бы ответы с репетиции
    since = store.get_meta("sheet_since") or os.getenv("SHEET_SINCE") or None
    since = dt.datetime.fromisoformat(since) if since else None
    for form, url in sources().items():
        try:
            r = client.get(url, follow_redirects=True, timeout=10)
            r.raise_for_status()
            df = pd.read_csv(io.StringIO(r.content.decode("utf-8-sig")), dtype=str)
        except Exception as e:  # noqa: BLE001 — сеть на площадке может моргать, просто пробуем снова
            log.warning("CSV %s: %s", form, e)
            continue
        for rec in df.to_dict("records"):  # строки по порядку: более поздний ответ за тот же месяц побеждает
            if is_stale(rec, since):
                continue
            try:
                changed += service.ingest_answer(form, rec, via="google")["changed"]
            except ValueError as e:
                log.warning("CSV %s: строка пропущена: %s", form, e)
    return changed


def start(stop: threading.Event) -> threading.Thread | None:
    if not sources():
        log.info("SHEET_CSV_* не заданы — опрос таблиц выключен, работает только вебхук")
        return None
    every = float(os.getenv("POLL_SECONDS", "5"))

    def loop():
        with httpx.Client() as client:
            while not stop.is_set():
                n = poll_once(client)
                if n:
                    log.info("из таблиц пришло новых/изменённых ответов: %d", n)
                stop.wait(every)

    t = threading.Thread(target=loop, name="sheets-poller", daemon=True)
    t.start()
    log.info("опрос таблиц ответов каждые %s с: %s", every, ", ".join(sources()))
    return t
