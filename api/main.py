"""REST API. Запуск: uvicorn api.main:app --port 8000   (дашборд — http://localhost:8000/)

Контракт — в CLAUDE.md:
  GET  /api/overview?period=N        общая картина
  GET  /api/interns/{id}?period=N    карточка стажёра
  GET  /api/version                  версия данных + последнее событие (фронт опрашивает раз в 3 с)
  POST /api/webhook/{intern|mentor}  ответ из формы (Apps Script onFormSubmit)
  POST /api/import                   загрузка xlsx кейса (один или оба файла)
"""
from __future__ import annotations

import json
import logging
import os
import threading
from contextlib import asynccontextmanager
from datetime import datetime
from typing import Optional
from urllib.parse import parse_qsl

import pandas as pd
from fastapi import FastAPI, File, Header, HTTPException, Query, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from feedback import ingest, pipeline, store
from feedback.config import ROOT, settings
from feedback.schemas import FeedbackItem, Insights, ItemAnalysis, Role

from . import cabinet, chat, poller, service

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s: %(message)s", datefmt="%H:%M:%S")
logging.getLogger("httpx").setLevel(logging.WARNING)  # опрос таблиц раз в 5 с не должен засорять лог
log = logging.getLogger("api")
WEBHOOK_SECRET = os.getenv("WEBHOOK_SECRET", "")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    log.info("история: %s", store.seed())
    log.info("анализ: %s", service.ANALYSIS)
    stop = threading.Event()
    poller.start(stop)
    yield
    stop.set()


app = FastAPI(title="Код города — обратная связь стажёров", version="0.2.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


@app.get("/health")
def health():
    return {"status": "ok", "engine": settings.engine(), "label": settings.engine_label(),
            "analysis": service.ANALYSIS, "polling": list(poller.sources()), **store.get_version()}


# ---------- контракт для фронта ----------

@app.get("/api/overview")
def api_overview(period: Optional[int] = Query(None, ge=1)):
    return service.overview(period)


@app.get("/api/interns/{intern_id}")
def api_intern(intern_id: str, period: Optional[int] = Query(None, ge=1)):
    try:
        return service.intern(intern_id, period)
    except KeyError:
        raise HTTPException(404, f"нет стажёра {intern_id}")


class ReviewIn(BaseModel):
    status: str  # confirmed | in_work | false_alarm | none (снять отметку)
    note: Optional[str] = None


@app.post("/api/signals/{signal_id}/review")
def api_review(signal_id: str, body: ReviewIn):
    """Решение HR по сигналу. signal_id — поле id сигнала из /api/interns/{id} («СТ-004|4|код»)."""
    try:
        res = store.set_review(signal_id, body.status, body.note)
    except ValueError as e:
        raise HTTPException(422, str(e))
    return {**res, **store.get_version()}


@app.post("/api/chat")
def api_chat(body: chat.ChatIn):
    """Чат «Спросить Радар». answer=null — у бэка нет LLM, фронт отвечает сам по данным."""
    return chat.answer(body)


@app.get("/api/version")
def api_version():
    return store.get_version()


# ---------- приём ответов ----------

WEBHOOK_LOG = ROOT / "data" / "webhook_log.jsonl"


@app.post("/api/webhook/{form}")
async def api_webhook(form: str, request: Request, x_webhook_secret: Optional[str] = Header(None),
                      secret: Optional[str] = Query(None),
                      source: str = Query("webhook", description="google | yandex | test — подпись в last_event")):
    """Ответ из формы. Принимает JSON нашего формата, Apps Script, Яндекс Форм (HTTP-запрос / JSON-RPC)
    и application/x-www-form-urlencoded. Сырое тело пишется в data/webhook_log.jsonl для отладки."""
    if WEBHOOK_SECRET and WEBHOOK_SECRET not in (x_webhook_secret, secret):
        raise HTTPException(401, "неверный секрет вебхука")
    if form not in ("intern", "mentor", "auto"):
        raise HTTPException(404, "форма должна быть intern или mentor")
    raw = await request.body()
    try:
        body = json.loads(raw.decode("utf-8")) if raw.strip() else {}
    except ValueError:
        body = dict(parse_qsl(raw.decode("utf-8", "replace")))
    try:
        WEBHOOK_LOG.parent.mkdir(parents=True, exist_ok=True)
        with WEBHOOK_LOG.open("a", encoding="utf-8") as f:
            f.write(json.dumps({"at": datetime.now().isoformat(timespec="seconds"), "form": form, "source": source,
                                "body": body}, ensure_ascii=False) + "\n")
    except OSError:
        pass
    answers = ingest.flatten_answers(body)
    try:
        res = service.ingest_answer(None if form == "auto" else form, answers, via=source)
    except ValueError as e:
        log.warning("вебхук %s/%s: %s; поля: %s", source, form, e, list(answers)[:20])
        raise HTTPException(422, f"{e}. Распознанные поля: {list(answers)[:20]}")
    return {**res, **store.get_version()}


@app.post("/api/import")
async def api_import(files: list[UploadFile] = File(...)):
    out = {}
    for f in files:
        try:
            df = pd.read_excel(await f.read())
            form = store.detect_form(df)
            out[f.filename] = {"form": form, "changed": store.import_frame(form, df, source="import")}
        except Exception as e:  # noqa: BLE001 — показываем, что не так с файлом
            raise HTTPException(400, f"{f.filename}: {e}")
    return {"files": out, **store.get_version()}


# ---------- старые эндпоинты заготовки (свободный текст) ----------

class TextIn(BaseModel):
    text: str
    role: Role = Role.unknown
    rating: Optional[float] = None


class ReportOut(BaseModel):
    engine: str
    stats: dict
    insights: Insights
    items: list[dict]


@app.post("/analyze", response_model=ItemAnalysis)
def analyze_one(body: TextIn):
    item = FeedbackItem(id="1", text=body.text, role=body.role, rating=body.rating)
    res = pipeline.run([item], with_insights=False)
    row = res.df.iloc[0]
    return ItemAnalysis(
        id=item.id, sentiment=row["sentiment"], sentiment_score=row["score"], topics=row["topics"],
        problems=row["problems"], suggestions=row["suggestions"], urgency=row["urgency"],
        churn_risk=bool(row["churn_risk"]), summary=row["summary"],
    )


@app.post("/report", response_model=ReportOut)
async def report(file: UploadFile = File(...)):
    try:
        items = ingest.load(await file.read(), filename=file.filename)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(400, f"Не удалось прочитать файл: {e}")
    if not items:
        raise HTTPException(400, "В файле нет отзывов")
    res = pipeline.run(items)
    out = res.df.copy()
    out["date"] = out["date"].astype(str)
    return ReportOut(engine=res.engine, stats=res.stats, insights=res.insights, items=out.to_dict("records"))


app.include_router(cabinet.router)  # кабинет стажёра и инструменты HR (web/shared/store.js)


# ---------- фронт Артёма (web/) по корню; монтируем последним ----------
WEB = ROOT / "web"
if WEB.exists():
    app.mount("/", StaticFiles(directory=WEB, html=True), name="web")
