"""Куб (/api/intern-chat): без ключей LLM отвечает null, фронт показывает фрагмент памятки сам."""
from fastapi.testclient import TestClient

from api import intern_chat
from api.main import app


def test_offline_returns_null(monkeypatch):
    monkeypatch.setattr(intern_chat.pipeline, "get_provider", lambda: None)
    r = TestClient(app).post("/api/intern-chat", json={
        "question": "где пропуск", "fragments": [{"title": "Пропуск", "source": "Памятка", "text": "Пропуск выдают в первый день."}]})
    assert r.status_code == 200
    assert r.json() == {"answer": None, "engine": "offline"}


def test_llm_answers_only_when_found(monkeypatch):
    class Fake:
        name = "fake"

        def __init__(self, found):
            self.found = found

        def complete(self, system, user, schema, kind):
            assert "Пропуск выдают" in user
            return schema(found=self.found, answer="Пропуск дадут в первый день по паспорту." if self.found else "")

    body = {"question": "где пропуск", "fragments": [{"title": "Пропуск", "text": "Пропуск выдают в первый день."}]}
    monkeypatch.setattr(intern_chat.pipeline, "get_provider", lambda: Fake(True))
    assert TestClient(app).post("/api/intern-chat", json=body).json()["engine"] == "fake"
    monkeypatch.setattr(intern_chat.pipeline, "get_provider", lambda: Fake(False))
    assert TestClient(app).post("/api/intern-chat", json=body).json()["answer"] is None
