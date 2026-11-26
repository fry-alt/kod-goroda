"""Rank documentation fragments for the Radar chat using local BM25."""
from collections import Counter
from math import log1p
import re

from feedback.config import ROOT

DOC_PATHS = (
    ROOT / "data" / "knowledge",
    ROOT / "docs" / "case_full.md",
    ROOT / "docs" / "surveys_structure.md",
)
MAX_FRAGMENT = 1000
TARGET_FRAGMENT = 600
WORD = re.compile(r"[a-zа-я0-9]+")
STOP_WORDS = {
    "где", "есть", "или", "как", "какая", "какие", "какой", "когда", "кто",
    "мне", "можно", "надо", "нужно", "почему", "сколько", "что", "чтобы", "это",
}


def _terms(text: str) -> list[str]:
    words = WORD.findall(text.casefold().replace("ё", "е"))
    # A short prefix matches common Russian inflections (анкета, анкеты, анкетой).
    return [word[:5] if word[0] in "абвгдежзийклмнопрстуфхцчшщъыьэюя" else word
            for word in words if len(word) >= 3 and word not in STOP_WORDS]


def _files():
    for path in DOC_PATHS:
        if path.is_file():
            yield path
        elif path.is_dir():
            for file in sorted(path.rglob("*")):
                if file.is_file() and file.suffix.lower() in {".md", ".txt"} and file.name.lower() != "readme.md":
                    yield file


def _fragments(text: str):
    for paragraph in re.split(r"\n\s*\n|\n(?=#{1,6} )", text):
        paragraph = paragraph.strip()
        if not paragraph or re.fullmatch(r"#{1,6} [^\n]+", paragraph):
            continue
        while len(paragraph) > TARGET_FRAGMENT:
            end = paragraph.rfind("\n", TARGET_FRAGMENT // 2, MAX_FRAGMENT + 1)
            if end == -1 and len(paragraph) <= MAX_FRAGMENT:
                break
            if end == -1:
                sentence = paragraph.rfind(". ", TARGET_FRAGMENT // 2, MAX_FRAGMENT + 1)
                end = sentence + 1 if sentence != -1 else paragraph.rfind(" ", 0, MAX_FRAGMENT + 1)
            if end <= 0:
                end = MAX_FRAGMENT
            yield paragraph[:end].rstrip()
            paragraph = paragraph[end:].lstrip()
        if paragraph:
            yield paragraph


def search(question: str, k: int = 4) -> list[dict]:
    """Return up to k matching fragments with filename and source text."""
    query = set(_terms(question))
    if not query or k <= 0:
        return []

    corpus = []
    frequency = Counter()
    for file in _files():
        try:
            content = file.read_text(encoding="utf-8-sig", errors="replace")
        except OSError:
            continue
        for fragment in _fragments(content):
            terms = Counter(_terms(fragment))
            if terms:
                corpus.append(({"title": file.name, "text": fragment}, terms, sum(terms.values())))
                frequency.update(query.intersection(terms))
    if not frequency:
        return []

    size = len(corpus)
    average_length = sum(length for _, _, length in corpus) / size
    weights = {term: log1p((size - count + 0.5) / (count + 0.5))
               for term, count in sorted(frequency.items())}
    ranked = []
    for fragment, terms, length in corpus:
        norm = 1.2 * (0.25 + 0.75 * length / average_length)
        relevance = sum(weight * (2.2 * terms[term]) / (terms[term] + norm)
                        for term, weight in weights.items())
        if relevance > 0:
            ranked.append((relevance, fragment))
    ranked.sort(key=lambda item: item[0], reverse=True)
    return [fragment for _, fragment in ranked[:k]]
