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


# ---------- LLM-слой без сети ----------

from feedback.analyzers import llm  # noqa: E402
from feedback.schemas import BatchAnalysis, Insights  # noqa: E402


class FakeProvider:
    """Отвечает разметкой офлайн-анализатора, но «теряет» отзыв с id=2."""
    name, model = "fake", "fake-1"

    def __init__(self):
        self.calls = 0

    def complete(self, system, user, schema, kind):
        self.calls += 1
        if schema is Insights:
            return Insights(headline="H", key_findings=["f"], risks=["r"], recommendations=["x"])
        from feedback.analyzers import offline
        items = [i for i in ingest.load(SAMPLE) if f'id="{i.id}"' in user]
        out = [offline.analyze_item(i) for i in items if i.id != "2"]  # «модель» потеряла id=2
        return BatchAnalysis(items=out)


def test_llm_layer_with_fake_provider(tmp_path, monkeypatch):
    import dataclasses
    monkeypatch.setattr(llm, "settings", dataclasses.replace(llm.settings, cache_dir=tmp_path))
    items = ingest.load(SAMPLE)
    p = FakeProvider()
    res = llm.analyze(p, items)
    assert [a.id for a in res] == [i.id for i in items]   # порядок и полнота сохранены
    first_calls = p.calls
    llm.analyze(p, items)                                   # второй прогон — почти всё из кеша
    assert p.calls - first_calls == 1                       # перезапрашиваем только потерянный id=2
    assert llm.insights(p, {"total": 1}).headline == "H"


def test_inline_schema_has_no_refs():
    import json
    s = json.dumps(llm.inline_schema(BatchAnalysis))
    assert "$ref" not in s and "$defs" not in s and '"enum"' in s


def test_yandex_provider_builds_request(monkeypatch):
    """Проверяем, что SDK Яндекса принимает нашу схему, и разбор ответа — без сети."""
    monkeypatch.setenv("YC_API_KEY", "test")
    monkeypatch.setenv("YC_FOLDER_ID", "b1gtest")
    from types import SimpleNamespace
    from feedback.analyzers import yandex
    from yandex_ai_studio_sdk._types.schemas import http_schema_from_response_format

    captured = {}

    class FakeModel:
        def configure(self, **kw):
            captured.update(kw)
            http_schema_from_response_format(kw["response_format"])  # бросит, если формат не тот
            return self

        def run(self, messages):
            captured["messages"] = messages
            return SimpleNamespace(status=SimpleNamespace(name="FINAL"),
                                   text='{"headline":"h","key_findings":[],"risks":[],"recommendations":[]}')

    p = yandex.YandexProvider()
    p.sdk = SimpleNamespace(models=SimpleNamespace(completions=lambda name: FakeModel()))
    out = p.complete("sys", "user", Insights, kind="report")
    assert out.headline == "h"
    assert captured["messages"][0] == {"role": "system", "text": "sys"}
    assert captured["response_format"]["strict"] is True
