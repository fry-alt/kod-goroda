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


def test_signal_review_roundtrip(client):
    from urllib.parse import quote
    c, store = client
    card = c.get("/api/interns/СТ-004", params={"period": 4}).json()
    if not card["signals"]:
        pytest.skip("анализ без сигналов (fallback)")
    sig = card["signals"][0]
    assert sig["id"].startswith("СТ-004|4|") and sig["review"] is None
    v0 = c.get("/api/version").json()["version"]
    r = c.post(f"/api/signals/{quote(sig['id'], safe='')}/review", json={"status": "confirmed", "note": "встреча 1:1"})
    assert r.status_code == 200 and r.json()["version"] == v0 + 1
    again = c.get("/api/interns/СТ-004", params={"period": 4}).json()
    got = {s["id"]: s for s in again["signals"]}[sig["id"]]
    assert got["review"]["status"] == "confirmed" and got["review"]["note"] == "встреча 1:1"
    assert c.post(f"/api/signals/{quote(sig['id'], safe='')}/review", json={"status": "none"}).status_code == 200
    assert {s["id"]: s for s in c.get("/api/interns/СТ-004", params={"period": 4}).json()["signals"]}[sig["id"]]["review"] is None
    assert c.post("/api/signals/bad/review", json={"status": "confirmed"}).status_code == 422


def test_chat_offline_returns_null_and_context(client, monkeypatch):
    from api import chat
    c, _ = client
    monkeypatch.setattr(chat.pipeline, "get_provider", lambda: None)
    r = c.post("/api/chat", json={"question": "Почему СТ-004 красный?", "period": 4, "history": []}).json()
    assert r["answer"] is None and "карточка СТ-004" in r["sources"]


def test_chat_with_llm_gets_card_and_docs(client, monkeypatch):
    from api import chat
    c, _ = client
    seen = {}

    class Fake:
        name = "fake"

        def complete(self, system, user, schema, kind):
            seen["user"] = user
            return schema(answer="СТ-004: нагрузка 2 в Месяце 4.", sources=["карточка СТ-004"])

    monkeypatch.setattr(chat.pipeline, "get_provider", lambda: Fake())
    r = c.post("/api/chat", json={"question": "что с ст-4 и какая шкала у наставника?", "period": 4}).json()
    assert r["answer"].startswith("СТ-004") and r["engine"] == "fake"
    assert '<intern id="СТ-004">' in seen["user"] and "Комфортность нагрузки" in seen["user"]
    assert "<doc" in seen["user"]


def test_reset_ignores_rehearsal_rows_in_sheet(client, monkeypatch):
    """После --reset старые строки Google Таблицы не возвращаются, новые — приходят."""
    import datetime as dt

    import httpx

    import api.poller as poller
    c, store = client
    store.reset()
    since = dt.datetime.fromisoformat(store.get_meta("sheet_since"))
    old = (since - dt.timedelta(minutes=5)).strftime("%d.%m.%Y %H:%M:%S")
    new = (since + dt.timedelta(minutes=5)).strftime("%d.%m.%Y %H:%M:%S")
    head = ["Отметка времени", "ID стажера", "Контрольный период", *store.FORMS["intern"]["scores"]]
    rows = [[old, "СТ-002", "Месяц 2", *["1"] * 7],   # репетиция: перезаписала бы историю
            [new, "СТ-002", "Месяц 7", *["2"] * 7]]   # живой ответ на защите
    csv = "\n".join(",".join(r) for r in [head, *rows])
    monkeypatch.setenv("SHEET_CSV_INTERN", "http://sheet.test/intern.csv")
    v0 = store.get_version()["version"]
    with httpx.Client(transport=httpx.MockTransport(lambda req: httpx.Response(200, text=csv))) as http:
        assert poller.poll_once(http) == 1
    h = store.load_history()
    st2 = h.interns[h.interns[store.INTERN_ID] == "СТ-002"].set_index("period")
    assert st2.loc[2, "source"] == "history" and st2.loc[2, "Понятность задач"] != 1
    assert st2.loc[7, "Понятность задач"] == 2
    assert store.get_version()["version"] == v0 + 1


def test_cabinet_endpoints_share_data_and_bump_version(client):
    """Ручки из web/shared/store.js: стажёр и HR с разных устройств видят одни данные."""
    c, store = client
    v0 = c.get("/api/version").json()["version"]

    req = {"id": "r1", "intern_id": "СТ-002", "type": "load", "text": "Слишком много задач", "anon": False}
    assert c.post("/api/intern-requests", json=req).json()["id"] == "r1"
    assert c.post("/api/intern-requests", json={**req, "status": "done"}).status_code == 200  # тот же id — замена
    got = c.get("/api/intern-requests").json()
    assert len(got) == 1 and got[0]["status"] == "done" and got[0]["at"]

    c.post("/api/kudos", json={"intern_id": "СТ-002", "role": "HR", "kind": "kudos", "text": "Молодец"})
    c.post("/api/kudos", json={"intern_id": "СТ-003", "role": "HR", "kind": "grow", "text": "Чаще спрашивай"})
    assert [k["text"] for k in c.get("/api/kudos", params={"intern_id": "СТ-002"}).json()] == ["Молодец"]
    assert len(c.get("/api/kudos").json()) == 2

    c.post("/api/checklist/СТ-002", json={"done": ["pass", "laptop"]})
    assert c.get("/api/checklist/СТ-002").json()["done"] == ["pass", "laptop"]
    assert c.get("/api/checklist/СТ-005").json()["done"] == []

    memo = c.get("/api/onboarding").json()
    assert "memo" in memo
    c.put("/api/onboarding", json={**memo, "edited": True})
    assert c.get("/api/onboarding").json()["edited"] is True

    assert c.post("/api/huntflow/sync", json={"intern_id": "СТ-002", "period": 6}).json()["demo"] is True
    assert c.post("/api/remind", json={"who": "СТ-004", "period": 6}).json()["ok"] is True
    for kind in ("feedback-requests", "meetings"):
        assert c.post(f"/api/{kind}", json={"intern_id": "СТ-001", "text": "x"}).status_code == 200
        assert len(c.get(f"/api/{kind}").json()) == 1

    v = c.get("/api/version").json()
    assert v["version"] > v0 and v["last_event"]["intern_id"] is None  # без тоста «Новый ответ» на дашборде
    assert c.post("/api/kudos", content="[1]", headers={"Content-Type": "application/json"}).status_code == 400
    assert c.post("/api/kudos", content="x" * 70_000).status_code == 413


def test_google_replay_and_late_webhook_keep_newest_answer(client, monkeypatch):
    import httpx

    from api import poller

    c, store = client
    answers = {
        store.INTERN_ID: "СТ-002",
        store.PERIOD_RAW: "Месяц 6",
        **dict.fromkeys(store.INTERN_SCORES, 4),
        store.INTERN_TEXTS[0]: "Новый ответ",
        "Отметка времени": "2026-11-26T08:01:00Z",
    }
    first = c.post("/api/webhook/intern?source=google", json={"answers": answers})
    assert first.status_code == 200
    assert first.json()["changed"]
    version = first.json()["version"]

    header = ["Отметка времени", store.INTERN_ID, store.PERIOD_RAW, *store.INTERN_SCORES, store.INTERN_TEXTS[0]]
    sheet = ",".join(header) + "\n26.11.2026 11:00:00,СТ-002,Месяц 6,4,4,4,4,4,4,4,Старый ответ"
    sheet += "\n26.11.2026 11:01:00,СТ-002,Месяц 6,4,4,4,4,4,4,4,Новый ответ"
    monkeypatch.setenv("SHEET_CSV_INTERN", "http://sheet.test/intern.csv")
    with httpx.Client(transport=httpx.MockTransport(lambda req: httpx.Response(200, text=sheet))) as http:
        assert poller.poll_once(http) == 0
        assert poller.poll_once(http) == 0

    answers["Отметка времени"] = "2026-11-26T08:00:00Z"
    answers[store.INTERN_TEXTS[0]] = "Старый ответ"
    late = c.post("/api/webhook/intern?source=google", json={"answers": answers})
    assert late.status_code == 200 and not late.json()["changed"]
    assert late.json()["version"] == version
    hist = store.load_history()
    current = hist.interns[(hist.interns[store.INTERN_ID] == "СТ-002") & (hist.interns["period"] == 6)]
    assert current.iloc[0][store.INTERN_TEXTS[0]] == "Новый ответ"


@pytest.mark.parametrize("intern,mentor", [("СТ-999", "Н-002"), ("СТ-002", "Н-003")])
def test_webhook_rejects_invalid_roster_without_changing_history(client, intern, mentor):
    c, store = client
    version = store.get_version()["version"]
    answers = {
        store.INTERN_ID: intern,
        store.MENTOR_ID: mentor,
        store.PERIOD_RAW: "Месяц 6",
        **dict.fromkeys(store.MENTOR_SCORES, 1),
    }
    response = c.post("/api/webhook/mentor", json={"answers": answers})
    assert response.status_code == 422
    assert store.get_version()["version"] == version
