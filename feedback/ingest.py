"""Загрузка отзывов из CSV / XLSX / JSON с автоматическим сопоставлением колонок.

Формат организаторов неизвестен, поэтому колонки ищем по синонимам.
Если не угадали — добавьте синоним в COLUMN_ALIASES или передайте mapping явно.
"""
from __future__ import annotations

import hashlib
import io
from pathlib import Path
from typing import IO, Optional, Union

import pandas as pd

from .schemas import FeedbackItem, Role

COLUMN_ALIASES: dict[str, list[str]] = {
    "id": ["id", "feedback_id", "номер", "№", "ид"],
    "text": ["text", "feedback", "comment", "review", "отзыв", "текст", "комментарий", "обратная связь", "ответ"],
    "role": ["role", "author_role", "type", "роль", "тип", "кто пишет", "от кого"],
    "author": ["author", "from", "автор", "фио", "сотрудник", "респондент"],
    "subject": ["subject", "about", "mentor", "intern", "о ком", "наставник", "стажер", "стажёр"],
    "department": ["department", "team", "dept", "отдел", "подразделение", "команда", "направление"],
    "date": ["date", "created_at", "timestamp", "дата", "время"],
    "rating": ["rating", "score", "grade", "nps", "оценка", "балл", "рейтинг"],
}

ROLE_ALIASES = {
    Role.intern: ["intern", "стажер", "стажёр", "студент", "trainee"],
    Role.mentor: ["mentor", "наставник", "ментор", "руководитель", "куратор"],
}

Source = Union[str, Path, IO[bytes]]


def _norm(s: str) -> str:
    return str(s).strip().lower().replace("_", " ")


def detect_columns(columns: list[str]) -> dict[str, str]:
    """Возвращает {поле: исходная колонка}. Сначала точные совпадения, потом вхождения."""
    found: dict[str, str] = {}
    normed = {c: _norm(c) for c in columns}
    for field, aliases in COLUMN_ALIASES.items():
        al = [_norm(a) for a in aliases]
        for col, n in normed.items():
            if col not in found.values() and n in al:
                found[field] = col
                break
    for field, aliases in COLUMN_ALIASES.items():
        if field in found:
            continue
        al = [_norm(a) for a in aliases if len(a) > 3]
        for col, n in normed.items():
            if col not in found.values() and any(a in n for a in al):
                found[field] = col
                break
    return found


def _parse_role(value) -> Role:
    v = _norm(value) if value is not None else ""
    for role, aliases in ROLE_ALIASES.items():
        if any(a in v for a in aliases):
            return role
    return Role.unknown


def read_table(source: Source, filename: Optional[str] = None) -> pd.DataFrame:
    name = (filename or getattr(source, "name", None) or str(source)).lower()
    if isinstance(source, (bytes, bytearray)):
        source = io.BytesIO(source)
    if name.endswith((".xlsx", ".xls")):
        return pd.read_excel(source)
    if name.endswith(".json") or name.endswith(".jsonl"):
        return pd.read_json(source, lines=name.endswith(".jsonl"))
    # CSV: пробуем угадать разделитель (часто ';' в русских выгрузках)
    return pd.read_csv(source, sep=None, engine="python", encoding_errors="replace")


def to_items(df: pd.DataFrame, mapping: Optional[dict[str, str]] = None) -> list[FeedbackItem]:
    mapping = {**detect_columns(list(df.columns)), **(mapping or {})}
    if "text" not in mapping:
        # fallback: самая «длинная» текстовая колонка
        obj = df.select_dtypes(include=["object", "string"])
        if obj.empty:
            raise ValueError(f"Не нашли колонку с текстом отзыва. Колонки: {list(df.columns)}")
        mapping["text"] = obj.apply(lambda s: s.astype(str).str.len().mean()).idxmax()

    used = set(mapping.values())
    items: list[FeedbackItem] = []
    for i, row in df.iterrows():
        text = row.get(mapping["text"])
        if pd.isna(text) or not str(text).strip():
            continue
        text = str(text).strip()

        def get(field):
            col = mapping.get(field)
            if col is None:
                return None
            v = row.get(col)
            return None if pd.isna(v) else v

        raw_id = get("id")
        item_id = str(raw_id) if raw_id is not None else hashlib.md5(f"{i}:{text}".encode()).hexdigest()[:10]
        raw_date = get("date")
        parsed_date = pd.to_datetime(raw_date, dayfirst=True, errors="coerce") if raw_date is not None else None
        raw_rating = get("rating")
        rating = pd.to_numeric(str(raw_rating).replace(",", "."), errors="coerce") if raw_rating is not None else None
        items.append(
            FeedbackItem(
                id=item_id,
                text=text,
                role=_parse_role(get("role")),
                author=str(get("author")) if get("author") is not None else None,
                subject=str(get("subject")) if get("subject") is not None else None,
                department=str(get("department")) if get("department") is not None else None,
                date=None if parsed_date is None or pd.isna(parsed_date) else parsed_date.date(),
                rating=None if rating is None or pd.isna(rating) else float(rating),
                extra={c: (None if pd.isna(row[c]) else row[c]) for c in df.columns if c not in used},
            )
        )
    return items


def load(source: Source, filename: Optional[str] = None, mapping: Optional[dict[str, str]] = None) -> list[FeedbackItem]:
    return to_items(read_table(source, filename), mapping)


# ======================================================================================
# Кейс МГТС: ответы из форм (вебхук Apps Script / CSV таблицы ответов) → строка истории.
# Вопрос в форме называется «<Название показателя> — <утверждение>» или просто «<Название показателя>»,
# поэтому колонку находим по точному совпадению или по началу заголовка.
# ======================================================================================

from . import store as _store  # noqa: E402

_TIMESTAMP_HEADERS = {"отметка времени", "timestamp", "время", "дата"}


def _clean(value):
    if isinstance(value, list):  # e.namedValues в Apps Script отдаёт списки
        value = value[0] if value else None
    if value is None:
        return None
    if isinstance(value, float) and pd.isna(value):
        return None
    s = str(value).strip()
    return s or None


def match_column(title: str, columns: list[str]) -> Optional[str]:
    t = _norm(title).strip(" ?:*")
    by_len = sorted(columns, key=len, reverse=True)  # «Взаимодействие с наставником и командой» раньше «… с командой»
    for c in by_len:
        if t == _norm(c):
            return c
    for c in by_len:
        n = _norm(c)
        if t.startswith(n) and (len(t) == len(n) or not t[len(n)].isalnum()):
            return c
    return None


def parse_form_answer(form: str, answers: dict) -> dict:
    """{заголовок вопроса: ответ} → {колонка xlsx: значение}. Неизвестные поля игнорируются."""
    cols = _store.FORMS[form]["cols"]
    row: dict = {}
    for title, value in answers.items():
        if _norm(title) in _TIMESTAMP_HEADERS:
            continue
        col = match_column(str(title), cols)
        if col and _clean(value) is not None:
            row[col] = _clean(value)
    for key in (_store.INTERN_ID, _store.MENTOR_ID):
        if row.get(key):
            row[key] = row[key].upper().replace("CT-", "СТ-").replace("H-", "Н-")  # латиница → кириллица
    return row


def guess_form(answers: dict) -> str:
    return "mentor" if any(match_column(str(t), [_store.MENTOR_ID]) for t in answers) else "intern"
