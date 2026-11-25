import io
import os

import pandas as pd

os.environ["LLM_PROVIDER"] = "offline"  # тесты не ходят в API

from fastapi.testclient import TestClient  # noqa: E402

from api.main import app  # noqa: E402
from feedback import ingest, pipeline  # noqa: E402
from feedback.config import ROOT  # noqa: E402
from feedback.schemas import Role  # noqa: E402

SAMPLE = ROOT / "data" / "sample" / "feedback.csv"


def test_detect_columns_ru_and_en():
    m = ingest.detect_columns(["ID", "Дата", "Роль", "Отзыв", "О ком", "Оценка"])
    assert m["text"] == "Отзыв" and m["role"] == "Роль" and m["subject"] == "О ком" and m["rating"] == "Оценка"
    m = ingest.detect_columns(["feedback_id", "comment", "author_role", "score"])
    assert m["text"] == "comment" and m["role"] == "author_role" and m["id"] == "feedback_id"


def test_load_sample():
    items = ingest.load(SAMPLE)
    assert len(items) == 32
    assert {i.role for i in items} == {Role.intern, Role.mentor}
    assert items[0].date is not None and items[0].rating == 5


def test_text_column_fallback_and_missing_values():
    df = pd.DataFrame({"x": [1, 2, 3], "что думаете": ["Всё отлично, спасибо", None, "Наставник игнорирует"]})
    items = ingest.to_items(df)
    assert [i.text for i in items] == ["Всё отлично, спасибо", "Наставник игнорирует"]


def test_offline_pipeline():
    res = pipeline.run(ingest.load(SAMPLE))
    assert res.engine == "offline"
    by_id = res.df.set_index("id")
    assert by_id.loc["1", "sentiment"] == "positive"
    assert by_id.loc["4", "churn_risk"] and by_id.loc["4", "urgency"] == "high"
    assert "4" in set(res.alerts["id"])
    assert res.stats["total"] == 32 and res.stats["mentors"]
    assert res.insights.key_findings


def test_api():
    client = TestClient(app)
    assert client.get("/health").json()["engine"] == "offline"
    r = client.post("/analyze", json={"text": "Наставник грубо отвечает, думаю уйти", "role": "intern"})
    assert r.status_code == 200 and r.json()["churn_risk"] is True
    r = client.post("/report", files={"file": ("f.csv", io.BytesIO(SAMPLE.read_bytes()), "text/csv")})
    assert r.status_code == 200 and r.json()["stats"]["total"] == 32
