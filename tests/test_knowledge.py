from fastapi.testclient import TestClient

from api import chat
from api.main import app
from feedback import knowledge


def test_search_prioritizes_terms_and_keeps_long_document_tail(tmp_path, monkeypatch):
    (tmp_path / "README.md").write_text("Порядок выдачи пропуска", encoding="utf-8")
    (tmp_path / "Анкеты.md").write_text("Наставник заполняет анкету ежемесячно.", encoding="utf-8")
    (tmp_path / "Доступ.txt").write_text("Общая информация. " * 100 +
                                        "Пропуск оформляет служба безопасности.", encoding="utf-8")
    monkeypatch.setattr(knowledge, "DOC_PATHS", (tmp_path,))

    hits = knowledge.search("Кто оформляет пропуска?", k=1)
    assert len(hits) == 1
    assert hits[0]["title"] == "Доступ.txt"
    assert "Пропуск оформляет служба безопасности." in hits[0]["text"]
    assert len(hits[0]["text"]) <= 1000
    assert knowledge.search("гиппопотам") == []
    assert knowledge.search("пропуск", k=0) == []


def test_chat_endpoint_passes_ranked_source_to_model(monkeypatch):
    class Provider:
        name = "yandex"

        def complete(self, system, prompt, schema, *, kind):
            assert '<doc title="case_full.md">' in prompt
            assert "Стажировка в МГТС длится шесть месяцев." in prompt
            return schema(answer="Шесть месяцев.", sources=["case_full.md"])

    monkeypatch.setattr(chat.pipeline, "get_provider", lambda: Provider())
    monkeypatch.setattr(chat.service, "overview", lambda period: {})
    response = TestClient(app).post("/api/chat", json={"question": "Сколько длится стажировка?"})
    assert response.status_code == 200
    assert response.json() == {
        "answer": "Шесть месяцев.", "sources": ["case_full.md"], "engine": "yandex",
    }
