"""Опрос таблиц ответов Google Forms (опубликованный CSV) раз в POLL_SECONDS.

В Google Таблице ответов: Файл → Поделиться → Опубликовать в интернете → лист ответов → CSV.
Ссылки положить в .env: SHEET_CSV_INTERN=..., SHEET_CSV_MENTOR=...
Каждая строка CSV проходит тот же разбор, что и вебхук; одинаковые строки версию не меняют.
"""
from __future__ import annotations

import io
import logging
import os
import threading

import httpx
import pandas as pd

from . import service

log = logging.getLogger("api.poller")


def sources() -> dict[str, str]:
    return {form: url for form, url in (("intern", os.getenv("SHEET_CSV_INTERN", "")),
                                        ("mentor", os.getenv("SHEET_CSV_MENTOR", ""))) if url}


def poll_once(client: httpx.Client) -> int:
    changed = 0
    for form, url in sources().items():
        try:
            r = client.get(url, follow_redirects=True, timeout=10)
            r.raise_for_status()
            df = pd.read_csv(io.StringIO(r.content.decode("utf-8-sig")), dtype=str)
        except Exception as e:  # noqa: BLE001 — сеть на площадке может моргать, просто пробуем снова
            log.warning("CSV %s: %s", form, e)
            continue
        for rec in df.to_dict("records"):  # строки по порядку: более поздний ответ за тот же месяц побеждает
            try:
                changed += service.ingest_answer(form, rec, via="form")["changed"]
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
