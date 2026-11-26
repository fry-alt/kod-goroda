"""История ответов: SQLite, загрузка xlsx кейса, upsert новых ответов, версия для автообновления дашборда.

Две таблицы — `interns` и `mentors`. Колонки ровно как в xlsx кейса плюс служебные:
`period` (int, из «Месяц 3» → 3), `source` ("history" | "form" | "webhook" | "test"), `received_at`.
Ключ записи — (ID стажера, period) внутри своей таблицы: повторный ответ за тот же месяц заменяет старый.

Для анализа (Савелий): `load_history(period=None) -> History(interns: DataFrame, mentors: DataFrame)`.
"""
from __future__ import annotations

import datetime as dt
import json
import sqlite3
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import pandas as pd

from .config import ROOT

DB_PATH = Path(__import__("os").getenv("DB_PATH", str(ROOT / "data" / "app.db")))
CASE_DIR = ROOT / "data" / "case"
INTERN_XLSX = CASE_DIR / "Ответы стажеров.xlsx"
MENTOR_XLSX = CASE_DIR / "Оценки наставников.xlsx"

# ---- колонки (дословно как в xlsx) ----
INTERN_ID = "ID стажера"
MENTOR_ID = "ID наставника"
DEPT = "Подразделение / направление стажировки"
PERIOD_RAW = "Контрольный период"

INTERN_SCORES = ["Понятность задач", "Поддержка и обратная связь наставника", "Комфортность нагрузки",
                 "Интерес к задачам", "Профессиональное развитие", "Взаимодействие с командой",
                 "Общая удовлетворенность стажировкой"]
INTERN_TEXTS = ["Сложности за период", "Что мешает работать и развиваться"]
MENTOR_SCORES = ["Понимание задач и ожиданий", "Качество выполнения задач", "Самостоятельность",
                 "Соблюдение сроков и организация работы", "Вовлеченность и инициативность",
                 "Взаимодействие с наставником и командой"]
MENTOR_TEXTS = ["Комментарий о работе за период", "Сложности / ситуации для внимания"]

INTERN_COLS = [INTERN_ID, DEPT, PERIOD_RAW, *INTERN_SCORES, *INTERN_TEXTS]
MENTOR_COLS = [MENTOR_ID, INTERN_ID, DEPT, PERIOD_RAW, *MENTOR_SCORES, *MENTOR_TEXTS]
SERVICE_COLS = ["period", "source", "received_at"]

FORMS = {
    "intern": {"table": "interns", "cols": INTERN_COLS, "scores": INTERN_SCORES, "label": "стажёр"},
    "mentor": {"table": "mentors", "cols": MENTOR_COLS, "scores": MENTOR_SCORES, "label": "наставник"},
}

_lock = threading.Lock()


@dataclass
class History:
    interns: pd.DataFrame   # колонки INTERN_COLS + period, source, received_at
    mentors: pd.DataFrame   # колонки MENTOR_COLS + period, source, received_at


def _q(name: str) -> str:
    return '"' + name.replace('"', '""') + '"'


def connect(path: Optional[Path] = None) -> sqlite3.Connection:
    p = Path(path or DB_PATH)
    p.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(p, check_same_thread=False)
    con.row_factory = sqlite3.Row
    return con


def init_db(con: sqlite3.Connection) -> None:
    for form in FORMS.values():
        cols = []
        for c in form["cols"]:
            typ = "INTEGER" if c in form["scores"] else "TEXT"
            cols.append(f"{_q(c)} {typ}")
        cols += ['"period" INTEGER NOT NULL', '"source" TEXT', '"received_at" TEXT']
        con.execute(f"CREATE TABLE IF NOT EXISTS {form['table']} ({', '.join(cols)}, "
                    f"PRIMARY KEY ({_q(INTERN_ID)}, period))")
    con.execute("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)")
    con.execute("CREATE TABLE IF NOT EXISTS signal_reviews (review_id TEXT PRIMARY KEY, intern_id TEXT, "
                "period INTEGER, code TEXT, status TEXT, note TEXT, at TEXT)")
    con.commit()


def parse_period(value) -> int:
    """«Месяц 3» / "3" / 3 / 3.0 → 3."""
    if value is None or (isinstance(value, float) and pd.isna(value)):
        raise ValueError("не указан контрольный период")
    if isinstance(value, (int, float)):
        return int(value)
    digits = "".join(ch for ch in str(value) if ch.isdigit())
    if not digits:
        raise ValueError(f"не удалось понять контрольный период: {value!r}")
    return int(digits)


# ---------- мета: версия и последнее событие ----------

def _meta_get(con, key, default=None):
    row = con.execute("SELECT value FROM meta WHERE key=?", (key,)).fetchone()
    return json.loads(row["value"]) if row else default


def _meta_set(con, key, value):
    con.execute("INSERT INTO meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                (key, json.dumps(value, ensure_ascii=False)))


def get_version(con: Optional[sqlite3.Connection] = None) -> dict:
    own = con is None
    con = con or connect()
    try:
        init_db(con)
        return {"version": _meta_get(con, "version", 0), "last_event": _meta_get(con, "last_event")}
    finally:
        if own:
            con.close()


# ---------- запись ----------

def upsert(form: str, row: dict, source: str = "form", con: Optional[sqlite3.Connection] = None,
           bump: bool = True) -> dict:
    """Записать один ответ. row — dict с колонками как в xlsx (лишние ключи игнорируются).

    Возвращает {"changed": bool, "intern_id", "period", "form"}. Версия растёт, только если данные изменились,
    поэтому опрос CSV, который видит одни и те же строки, не дёргает дашборд.
    """
    spec = FORMS[form]
    own = con is None
    con = con or connect()
    try:
        init_db(con)
        period = parse_period(row.get("period", row.get(PERIOD_RAW)))
        values = {c: row.get(c) for c in spec["cols"]}
        values[PERIOD_RAW] = values.get(PERIOD_RAW) or f"Месяц {period}"
        if not values.get(INTERN_ID):
            raise ValueError("не указан ID стажера")
        for c in spec["scores"]:
            v = values.get(c)
            if v is None or v == "":
                raise ValueError(f"нет оценки «{c}»")
            v = int(float(str(v).replace(",", ".")))
            if not 1 <= v <= 5:
                raise ValueError(f"оценка «{c}» = {v}, а должна быть 1–5")
            values[c] = v
        for c in spec["cols"]:
            if c not in spec["scores"] and values.get(c) is not None:
                values[c] = str(values[c]).strip()

        with _lock:
            old = con.execute(f"SELECT * FROM {spec['table']} WHERE {_q(INTERN_ID)}=? AND period=?",
                              (values[INTERN_ID], period)).fetchone()
            same = old is not None and all(old[c] == values[c] for c in spec["cols"])
            if same:
                return {"changed": False, "intern_id": values[INTERN_ID], "period": period, "form": form}
            now = dt.datetime.now().isoformat(timespec="seconds")
            cols = spec["cols"] + SERVICE_COLS
            data = [values[c] for c in spec["cols"]] + [period, source, now]
            con.execute(f"INSERT OR REPLACE INTO {spec['table']} ({', '.join(map(_q, cols))}) "
                        f"VALUES ({', '.join('?' * len(cols))})", data)
            if bump:
                _meta_set(con, "version", _meta_get(con, "version", 0) + 1)
                _meta_set(con, "last_event", {"intern_id": values[INTERN_ID], "period": period,
                                              "source": spec["label"], "via": source, "updated": old is not None,
                                              "at": dt.datetime.now().strftime("%H:%M:%S")})
            con.commit()
        return {"changed": True, "intern_id": values[INTERN_ID], "period": period, "form": form}
    finally:
        if own:
            con.close()


def import_frame(form: str, df: pd.DataFrame, source: str = "history",
                 con: Optional[sqlite3.Connection] = None) -> int:
    """Загрузить таблицу в формате xlsx кейса. Возвращает число изменённых строк; версия +1 один раз."""
    spec = FORMS[form]
    missing = [c for c in spec["cols"] if c not in df.columns]
    if missing:
        raise ValueError(f"в файле нет колонок: {missing}")
    own = con is None
    con = con or connect()
    try:
        changed = 0
        for rec in df.to_dict("records"):
            rec = {k: (None if isinstance(v, float) and pd.isna(v) else v) for k, v in rec.items()}
            changed += upsert(form, rec, source=source, con=con, bump=False)["changed"]
        if changed:
            with _lock:
                _meta_set(con, "version", _meta_get(con, "version", 0) + 1)
                _meta_set(con, "last_event", {"intern_id": None, "period": None, "source": "импорт",
                                              "via": source, "rows": changed,
                                              "at": dt.datetime.now().strftime("%H:%M:%S")})
                con.commit()
        return changed
    finally:
        if own:
            con.close()


def detect_form(df: pd.DataFrame) -> str:
    return "mentor" if MENTOR_ID in df.columns else "intern"


def seed(con: Optional[sqlite3.Connection] = None, force: bool = False) -> dict:
    """Загрузить исторические xlsx кейса. Без force — только если база пустая."""
    own = con is None
    con = con or connect()
    try:
        init_db(con)
        n = con.execute("SELECT (SELECT COUNT(*) FROM interns) + (SELECT COUNT(*) FROM mentors)").fetchone()[0]
        if n and not force:
            return {"skipped": True, "rows": n}
        a = import_frame("intern", pd.read_excel(INTERN_XLSX), con=con)
        b = import_frame("mentor", pd.read_excel(MENTOR_XLSX), con=con)
        return {"skipped": False, "interns": a, "mentors": b}
    finally:
        if own:
            con.close()


# ---------- решения HR по сигналам ----------

REVIEW_STATUSES = {"confirmed", "in_work", "false_alarm", "none"}


def review_id(intern_id: str, period: int, code: str) -> str:
    """Глобальный id сигнала: стажёр|период|код сигнала от анализа."""
    return f"{intern_id}|{int(period)}|{code}"


def set_review(rid: str, status: str, note: Optional[str] = None,
               con: Optional[sqlite3.Connection] = None) -> dict:
    if status not in REVIEW_STATUSES:
        raise ValueError(f"status должен быть одним из {sorted(REVIEW_STATUSES)}")
    try:
        intern_id, period, code = rid.split("|", 2)
        period = int(period)
    except ValueError:
        raise ValueError("id сигнала должен быть вида «СТ-004|4|код» (поле id в /api/interns/{id})")
    own = con is None
    con = con or connect()
    try:
        init_db(con)
        now = dt.datetime.now()
        with _lock:
            if status == "none":
                con.execute("DELETE FROM signal_reviews WHERE review_id=?", (rid,))
            else:
                con.execute("INSERT OR REPLACE INTO signal_reviews VALUES (?,?,?,?,?,?,?)",
                            (rid, intern_id, period, code, status, note, now.isoformat(timespec="seconds")))
            _meta_set(con, "version", _meta_get(con, "version", 0) + 1)
            _meta_set(con, "last_event", {"intern_id": intern_id, "period": period, "source": "HR",
                                          "via": "review", "review": status, "at": now.strftime("%H:%M:%S")})
            con.commit()
        return {"id": rid, "status": status, "note": note}
    finally:
        if own:
            con.close()


def get_reviews(intern_id: Optional[str] = None, con: Optional[sqlite3.Connection] = None) -> dict[str, dict]:
    own = con is None
    con = con or connect()
    try:
        init_db(con)
        sql, params = "SELECT * FROM signal_reviews", ()
        if intern_id:
            sql, params = sql + " WHERE intern_id=?", (intern_id,)
        return {r["review_id"]: {"status": r["status"], "note": r["note"], "at": r["at"]}
                for r in con.execute(sql, params)}
    finally:
        if own:
            con.close()


# ---------- чтение ----------

def load_history(period: Optional[int] = None, con: Optional[sqlite3.Connection] = None) -> History:
    """История для анализа. period=N — только ответы с period <= N («как было на Месяц N»)."""
    own = con is None
    con = con or connect()
    try:
        init_db(con)
        out = []
        for form in ("intern", "mentor"):
            spec = FORMS[form]
            sql = f"SELECT * FROM {spec['table']}"
            params: tuple = ()
            if period is not None:
                sql += " WHERE period <= ?"
                params = (int(period),)
            df = pd.read_sql_query(sql + f" ORDER BY {_q(INTERN_ID)}, period", con, params=params)
            out.append(df)
        return History(interns=out[0], mentors=out[1])
    finally:
        if own:
            con.close()


def roster(hist: History) -> list[dict]:
    """Пары стажёр ↔ наставник и подразделение (по всем ответам)."""
    people: dict[str, dict] = {}
    for df in (hist.interns, hist.mentors):
        for rec in df.to_dict("records"):
            p = people.setdefault(rec[INTERN_ID], {"intern_id": rec[INTERN_ID], "mentor_id": None, "department": None})
            p["department"] = p["department"] or rec.get(DEPT)
            if rec.get(MENTOR_ID):
                p["mentor_id"] = rec[MENTOR_ID]
    return sorted(people.values(), key=lambda p: p["intern_id"])


if __name__ == "__main__":
    import sys

    if "--reset" in sys.argv:  # после репетиции демо: стереть тестовые ответы и загрузить историю заново
        DB_PATH.unlink(missing_ok=True)
    print(seed(force="--force" in sys.argv))
    h = load_history()
    print(f"стажёры: {len(h.interns)} строк, наставники: {len(h.mentors)} строк, {get_version()}")
