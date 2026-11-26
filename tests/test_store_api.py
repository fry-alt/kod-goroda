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


def test_csv_poller_reads_google_sheet(client, monkeypatch):
    import httpx
    from api import poller
    c, store = client
    csv = ("Отметка времени,ID наставника,ID стажера,Подразделение / направление стажировки,Контрольный период,"
           + ",".join(f'"{s} — вопрос?"' for s in store.MENTOR_SCORES)
           + ',"Комментарий о работе за период — Опишите","Сложности / ситуации для внимания — Есть ли"\n'
           + "26.11.2026 11:05:00,Н-002,СТ-002,Коммерческий блок,Месяц 7,4,4,4,3,4,4,Сорваны сроки,Снизить нагрузку\n")
    monkeypatch.setenv("SHEET_CSV_MENTOR", "https://example.test/m.csv")
    transport = httpx.MockTransport(lambda req: httpx.Response(200, content=csv.encode("utf-8")))
    with httpx.Client(transport=transport) as cl:
        assert poller.poll_once(cl) == 1
        assert poller.poll_once(cl) == 0  # те же строки — без изменений
    h = store.load_history()
    row = h.mentors[(h.mentors["ID стажера"] == "СТ-002") & (h.mentors["period"] == 7)].iloc[0]
    assert row["Соблюдение сроков и организация работы"] == 3 and row["source"] == "google"


def _ya(label, value):
    return {"value": value, "question": {"label": {"ru": label}}}


def test_webhook_yandex_forms_payload(client):
    c, store = client
    body = {"id": 1, "survey": {"id": "s1", "name": "Пульс-опрос стажера"}, "answer": {"data": {
        "a1": _ya("ID стажера", [{"key": "5", "text": "СТ-005"}]),
        "a2": _ya("Контрольный период", [{"key": "7", "text": "Месяц 7"}]),
        **{f"s{i}": _ya(f"{col} — утверждение", 2 if col == "Комфортность нагрузки" else 4)
           for i, col in enumerate(store.INTERN_SCORES)},
        "t1": _ya("Сложности за период — С какими сложностями вы столкнулись?", "Много задач"),
    }}}
    r = c.post("/api/webhook/intern", params={"source": "yandex"}, json=body)
    assert r.status_code == 200, r.text
    assert r.json()["last_event"]["via"] == "yandex"
    h = store.load_history()
    row = h.interns[(h.interns["ID стажера"] == "СТ-005") & (h.interns["period"] == 7)].iloc[0]
    assert row["Комфортность нагрузки"] == 2 and row["Сложности за период"] == "Много задач"
    assert row["Подразделение / направление стажировки"] == "IT"


def test_webhook_yandex_jsonrpc_and_form_encoded(client):
    c, store = client
    params = {"ID наставника": "Н-001", "ID стажера": "СТ-001", "Контрольный период": "Месяц 7",
              **{col: "5" for col in store.MENTOR_SCORES}}
    r = c.post("/api/webhook/mentor", json={"jsonrpc": "2.0", "method": "answer", "params": params, "id": 1})
    assert r.status_code == 200, r.text
    params["Самостоятельность"] = "3"
    r = c.post("/api/webhook/mentor", data=params)  # x-www-form-urlencoded
    assert r.status_code == 200 and r.json()["changed"], r.text
