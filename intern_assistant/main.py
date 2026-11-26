"""Standalone, read-only assistant for interns."""
import json
import re
from pathlib import Path
from typing import Literal

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

HERE = Path(__file__).parent
DOCS = HERE.parent / "docs"
SOURCES = {
    "case": ("Условия кейса МГТС", "case_full.md", "Описание программы и ежемесячных опросов"),
    "survey": ("Структура пульс-опроса", "surveys_structure.md", "Показатели, шкала и открытые вопросы"),
}
TOPICS = json.loads((HERE / "knowledge.json").read_text(encoding="utf-8"))
app = FastAPI(title="Помощник стажёра")


class Question(BaseModel):
    question: str = Field(min_length=1, max_length=500)
    topic: str | None = Field(default=None, max_length=30)


class Reply(BaseModel):
    status: Literal["answered", "clarify", "unknown"]
    answer: str
    topic: str | None = None
    source: dict[str, str] | None = None
    draft: str | None = None
    suggestions: list[str] = Field(default_factory=list)


def normalize(value: str) -> str:
    return " ".join(re.findall(r"[а-яa-z0-9]+", value.lower().replace("ё", "е")))


def has(text: str, pattern: str) -> bool:
    return f" {normalize(pattern)}" in f" {text}"


@app.get("/api/topics")
def topics():
    return [topic["question"] for topic in TOPICS]


@app.get("/sources/{key}", response_class=FileResponse)
def source(key: Literal["case", "survey"]):
    return FileResponse(DOCS / SOURCES[key][1], media_type="text/plain; charset=utf-8")


@app.post("/api/ask", response_model=Reply)
def ask(body: Question):
    text = normalize(body.question)
    previous = next((topic for topic in TOPICS if topic["id"] == body.topic), None)
    if previous and previous.get("draft") and text in {
        "как это написать", "как написать", "дай пример", "покажи пример", "как сформулировать",
    }:
        return Reply(status="answered", topic=previous["id"], answer="Можно написать так.",
                     draft=previous["draft"])

    # Missing operational or personal information takes precedence over related terms.
    gaps = {
        "ссылк": "ссылку на актуальную форму",
        "дедлайн": "срок сдачи",
        "до какого": "крайний срок",
        "точн": "точные детали",
        "зарплат": "условия оплаты",
        "оплат": "условия оплаты",
        "отпуск": "условия отпуска",
        "аноним": "условия анонимности",
        "кто видит": "круг людей с доступом",
        "кто мой наставник": "контакт твоего наставника",
        "контакт наставник": "контакт твоего наставника",
        "где заполн": "адрес актуальной формы",
        "какого числа": "точную дату",
        "пропуст": "порядок действий при пропуске",
        "почему мне постав": "основания персональной оценки",
        "сколько получ": "условия оплаты",
    }
    missing = next((label for prefix, label in gaps.items() if has(text, prefix)), None)
    if missing:
        return Reply(status="unknown", answer=f"В доступных материалах не удалось подтвердить {missing}. Уточни у HR или координатора программы.")

    matches = []
    for topic in TOPICS:
        score = max((len(normalize(pattern)) for pattern in topic["patterns"] if has(text, pattern)), default=0)
        if text == normalize(topic["question"]):
            score = 100
        if score:
            matches.append((score, topic))
    matches.sort(key=lambda match: match[0], reverse=True)
    if not matches:
        return Reply(status="unknown", answer="В доступных материалах нет ответа на этот вопрос. По условиям программы можно обратиться к HR, по рабочей задаче к наставнику.",
                     suggestions=[topic["question"] for topic in TOPICS[:3]])

    score, topic = matches[0]
    if len(matches) > 1 and score - matches[1][0] < 3:
        return Reply(status="clarify", answer="Что именно хочешь уточнить?",
                     suggestions=[item["question"] for _, item in matches[:3]])
    if topic["id"] == "survey" and text in {"опрос", "анкета", "обратная связь"}:
        return Reply(status="clarify", answer="Что именно тебя интересует?",
                     suggestions=[TOPICS[0]["question"], TOPICS[2]["question"], TOPICS[-1]["question"]])

    title, _, section = SOURCES[topic["source"]]
    return Reply(status="answered", answer=topic["answer"], topic=topic["id"],
                 source={"title": title, "section": section, "url": f"sources/{topic['source']}"},
                 suggestions=["Как это написать?"] if topic.get("draft") else [])


app.mount("/", StaticFiles(directory=HERE / "static", html=True), name="assistant")
