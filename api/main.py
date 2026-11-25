"""REST API. Запуск: uvicorn api.main:app --reload"""
from __future__ import annotations

from typing import Optional

from fastapi import FastAPI, File, HTTPException, UploadFile
from pydantic import BaseModel

from feedback import ingest, pipeline
from feedback.config import settings
from feedback.schemas import FeedbackItem, Insights, ItemAnalysis, Role

app = FastAPI(title="Код города — анализ обратной связи", version="0.1.0")


class TextIn(BaseModel):
    text: str
    role: Role = Role.unknown
    rating: Optional[float] = None


class ReportOut(BaseModel):
    engine: str
    stats: dict
    insights: Insights
    items: list[dict]


@app.get("/health")
def health():
    return {"status": "ok", "engine": settings.engine(), "label": settings.engine_label()}


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
    except Exception as e:  # noqa: BLE001 — показываем пользователю, что не так с файлом
        raise HTTPException(400, f"Не удалось прочитать файл: {e}")
    if not items:
        raise HTTPException(400, "В файле нет отзывов")
    res = pipeline.run(items)
    out = res.df.copy()
    out["date"] = out["date"].astype(str)
    return ReportOut(engine=res.engine, stats=res.stats, insights=res.insights,
                     items=out.to_dict("records"))
