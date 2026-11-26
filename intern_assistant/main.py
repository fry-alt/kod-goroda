"""Standalone, read-only assistant for interns."""
import json
import re
from pathlib import Path
from typing import Literal

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from .intent import normalize, score

HERE = Path(__file__).parent
DOCS = HERE.parent / "docs"
KNOWLEDGE = json.loads((HERE.parent / "web" / "data" / "intern-assistant.json").read_text(encoding="utf-8"))
SOURCES = KNOWLEDGE["sources"]
TOPICS = KNOWLEDGE["topics"]
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
    parts: list["Reply"] = Field(default_factory=list)


GAPS = KNOWLEDGE["gaps"]
DRAFT_REQUESTS = KNOWLEDGE["draft_requests"]
QUESTION_SPLIT = re.compile(
    r"[?;\n]+|(?:,?\s+)(?:и|а)\s+(?=(?:как|сколько|где|куда|когда|кто|что|почему|до какого)\b)",
    re.IGNORECASE,
)


@app.get("/api/topics")
def topics():
    return [topic["question"] for topic in TOPICS]


@app.get("/sources/{key}", response_class=FileResponse)
def source(key: Literal["case", "survey"]):
    return FileResponse(DOCS / SOURCES[key][1], media_type="text/plain; charset=utf-8")


def unknown(detail: str | None = None) -> Reply:
    if detail:
        return Reply(status="unknown", answer=f"В доступных материалах не удалось подтвердить {detail}. Уточни у HR или координатора программы.")
    return Reply(status="unknown", answer="В доступных материалах нет ответа на этот вопрос. По условиям программы можно обратиться к HR, по рабочей задаче к наставнику.",
                 suggestions=[topic["question"] for topic in TOPICS[:3]])


def answer_one(text: str, previous: dict | None) -> Reply:
    words = normalize(text)
    gaps = [(score(words, expression), label) for expression, label in GAPS.items()]
    gap_score, missing = max(gaps, key=lambda match: match[0])
    if gap_score:
        return unknown(missing)

    matches = [
        (100 if words == normalize(topic["question"]) else
         max(score(words, pattern) for pattern in topic["patterns"]), topic)
        for topic in TOPICS
    ]
    matches = sorted((match for match in matches if match[0]), key=lambda match: match[0], reverse=True)
    wants_draft = any(score(words, pattern) for pattern in DRAFT_REQUESTS)
    if not matches:
        if previous and previous.get("draft") and wants_draft and len(words) <= 7:
            return Reply(status="answered", topic=previous["id"], answer="Можно написать так.",
                         draft=previous["draft"])
        if previous and previous["id"] == "survey" and words in {
            ("а", "где"), ("и", "где"), ("а", "куда"), ("где",), ("куда",),
        }:
            return unknown("ссылку на актуальную форму")
        if any(score(words, clue) for clue in ("опрос*|анкет*|пульс*", "оценк*|балл*", "наставник*|ментор*")):
            return Reply(status="clarify", answer="Что именно хочешь уточнить?",
                         suggestions=[TOPICS[index]["question"] for index in (0, 2, 5)])
        return unknown()

    best, topic = matches[0]
    if len(matches) > 1 and best - matches[1][0] < 3:
        return Reply(status="clarify", answer="Вижу несколько тем. С какой начнём?",
                     suggestions=[item["question"] for _, item in matches[:3]])

    title, _, section = SOURCES[topic["source"]]
    return Reply(status="answered", answer=topic["answer"], topic=topic["id"],
                 source={"title": title, "section": section, "url": f"sources/{topic['source']}"},
                 draft=topic.get("draft") if wants_draft else None,
                 suggestions=["Как это написать?"] if topic.get("draft") and not wants_draft else [])


@app.post("/api/ask", response_model=Reply)
def ask(body: Question):
    previous = next((topic for topic in TOPICS if topic["id"] == body.topic), None)
    questions = [part.strip() for part in QUESTION_SPLIT.split(body.question) if part.strip()]
    if len(questions) < 2:
        return answer_one(body.question, previous)
    replies = []
    for question in questions:
        reply = answer_one(question, previous)
        replies.append(reply)
        previous = next((topic for topic in TOPICS if topic["id"] == reply.topic), None)
    combined = next((reply for reply in reversed(replies) if reply.status == "answered"), replies[0])
    return combined.model_copy(update={"parts": replies})


app.mount("/", StaticFiles(directory=HERE / "static", html=True), name="assistant")
