"""История, разбор ответов форм и API (без сети и LLM)."""
import importlib

import pytest
from fastapi.testclient import TestClient


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("DB_PATH", str(tmp_path / "t.db"))
    monkeypatch.delenv("SHEET_CSV_INTERN", raising=False)
    monkeypatch.delenv("SHEET_CSV_MENTOR", raising=False)
    import feedback.store as store
    importlib.reload(store)
    import api.service, api.poller, api.main  # noqa: E401
    for m in (api.service, api.poller, api.main):
        importlib.reload(m)
    with TestClient(api.main.app) as c:
        yield c, store


def test_seed_loads_case_history(client):
    c, store = client
    h = store.load_history()
    assert len(h.interns) == 30 and len(h.mentors) == 30
    assert sorted(h.interns["period"].unique()) == [1, 2, 3, 4, 5, 6]
    assert len(store.load_history(3).interns) == 15


def test_webhook_adds_new_period_and_bumps_version(client):
    c, store = client
    v0 = c.get("/api/version").json()["version"]
    answers = {"Отметка времени": "26.11.2026 11:00", "ID стажера": "СТ-002", "Контрольный период": "Месяц 7",
               "Понятность задач — Мне понятно, каких результатов от меня ожидают": "3",
               "Поддержка и обратная связь наставника": 4, "Комфортность нагрузки": 2, "Интерес к задачам": 4,
               "Профессиональное развитие": 4, "Взаимодействие с командой": 4,
               "Общая удовлетворенность стажировкой": 3, "Сложности за период": "Не успеваю"}
    r = c.post("/api/webhook/intern", json={"answers": answers}).json()
    assert r["changed"] and r["period"] == 7 and r["version"] == v0 + 1
    assert r["last_event"]["intern_id"] == "СТ-002"
    # подразделение подставилось из истории
    h = store.load_history()
    row = h.interns[(h.interns["ID стажера"] == "СТ-002") & (h.interns["period"] == 7)].iloc[0]
    assert row["Подразделение / направление стажировки"] == "Коммерческий блок"
    assert row["Комфортность нагрузки"] == 2
    # повтор того же ответа — без изменений и без новой версии
    r2 = c.post("/api/webhook/intern", json={"answers": answers}).json()
    assert not r2["changed"] and r2["version"] == v0 + 1
    ov = c.get("/api/overview").json()
    assert ov["current_period"] == 7 and 7 in ov["periods"]
    st = {s["intern_id"]: s for s in ov["survey_status"]}
    assert st["СТ-002"]["periods"]["7"] == {"intern": True, "mentor": False}


def test_webhook_rejects_bad_score(client):
    c, _ = client
    bad = {"ID стажера": "СТ-001", "Контрольный период": "Месяц 7", "Понятность задач": 9}
    assert c.post("/api/webhook/intern", json=bad).status_code == 422


def test_overview_and_card_by_period(client):
    c, _ = client
    ov = c.get("/api/overview", params={"period": 4}).json()
    assert ov["current_period"] == 4 and len(ov["interns"]) == 5
    card = c.get("/api/interns/СТ-004", params={"period": 4}).json()
    assert [p["period"] for p in card["periods"]] == [1, 2, 3, 4]
    assert card["periods"][3]["intern"]["Комфортность нагрузки"] == 2
    assert c.get("/api/interns/СТ-999").status_code == 404
