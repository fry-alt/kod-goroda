"""Dashboard signals on the historical case data."""

import pytest

from feedback import store
from feedback.case import build_intern, build_overview


@pytest.fixture
def history(tmp_path, monkeypatch):
    from feedback.analyzers import case_comments
    monkeypatch.setattr(case_comments, "get_provider", lambda: None)
    monkeypatch.setattr(store, "DB_PATH", tmp_path / "case.db")
    store.seed()
    return store.load_history()


@pytest.mark.parametrize("period, intern_id, signal_id", [
    (2, "СТ-003", "low-intern"),
    (3, "СТ-003", "low-intern"),
    (1, "СТ-005", "low-intern"),
    (2, "СТ-005", "pair-Понятность задач"),
    (3, "СТ-005", "pair-Понятность задач"),
    (4, "СТ-004", "drop-intern-Комфортность нагрузки"),
])
def test_case_incidents(history, period, intern_id, signal_id):
    overview = build_overview(history, period)
    row = next(row for row in overview["interns"] if row["intern_id"] == intern_id)
    card = build_intern(history, intern_id, period)
    signal = next(signal for signal in card["signals"] if signal["id"] == signal_id)
    assert row["status"] == card["status"] == "red"
    assert row["signals"] == len(card["signals"])
    assert row["reason"] == card["signals"][0]["title"]
    assert signal["evidence"]
    assert max(item["period"] for item in signal["evidence"]) <= period
    if signal_id.startswith("drop-"):
        assert [item["value"] for item in signal["evidence"]] == [2, 5, 5, 4]
    if signal_id.startswith("pair-"):
        assert {item["period"] for item in signal["evidence"]} == {1, 2}


def test_recovery_in_month_six(history):
    overview = build_overview(history, 6)
    assert overview["kpi"]["green"] == 5
    for row in overview["interns"]:
        assert build_intern(history, row["intern_id"], 6)["signals"] == []


def test_missing_response_is_reported_without_reusing_previous_scores(history):
    mentors = history.mentors
    selected = (mentors[store.INTERN_ID] == "СТ-004") & (mentors["period"] == 4)
    incomplete = store.History(history.interns, mentors.loc[~selected])
    card = build_intern(incomplete, "СТ-004", 4)
    signal = next(signal for signal in card["signals"] if signal["id"] == "missing-mentor")
    assert signal["evidence"] == [
        {"source": "наставник", "period": 4, "field": "Анкета получена", "value": False}
    ]
    assert card["periods"][-1]["mentor_avg"] is None


def test_workload_comment_signal_cites_both_answers(history):
    card = build_intern(history, "СТ-004", 4)
    signal = next(signal for signal in card["signals"] if signal["id"] == "comment-workload")
    assert signal["level"] == "red"
    assert {item["source"] for item in signal["evidence"]} == {"стажёр", "наставник"}
    comments = card["periods"][-1]["comments"]
    for item in signal["evidence"]:
        assert any(item["quote"] in text for answers in comments.values() for text in answers.values())
    assert "загруз" in card["actions"][0].lower()


@pytest.mark.parametrize("text", [
    "Нагрузка вернулась к комфортному уровню.",
    "Сложностей за период не было.",
    "Ничего не мешает.",
])
def test_resolved_comments_are_not_risks(text):
    from feedback.analyzers import case_comments

    labels = case_comments.classify([{"period": 6, "comments": {"intern": {"Комментарий": text}}}])
    assert case_comments.period_label(labels[6])["risk"] is False


def test_live_text_only_response_changes_dashboard_signal(history):
    from api.main import app
    from fastapi.testclient import TestClient

    with TestClient(app) as client:
        args = {"period": 6}
        before = client.get("/api/interns/СТ-002", params=args).json()
        version = client.get("/api/version").json()["version"]
        answers = {
            store.INTERN_ID: "СТ-002",
            store.PERIOD_RAW: "Месяц 6",
            **before["periods"][-1]["intern"],
            store.INTERN_TEXTS[0]: "Думаю уйти, не успеваю справляться с нагрузкой.",
        }

        response = client.post("/api/webhook/intern?source=yandex", json={"answers": answers})
        assert response.status_code == 200
        assert client.get("/api/version").json()["version"] == version + 1
        after = client.get("/api/interns/СТ-002", params=args).json()
        overview = client.get("/api/overview", params=args).json()
        row = next(row for row in overview["interns"] if row["intern_id"] == "СТ-002")
        assert before["status"] == "green"
        assert after["periods"][-1]["intern"] == before["periods"][-1]["intern"]
        assert row["status"] == after["status"] == "red"
        assert after["periods"][-1]["comment_analysis"]["risk"] is True
        assert any("Думаю уйти" in item.get("quote", "")
                   for signal in after["signals"] for item in signal["evidence"])
        assert after["actions"]


@pytest.mark.parametrize("comments_llm", [None, "0"])
def test_offline_comment_statuses(history, monkeypatch, comments_llm):
    from feedback.analyzers import case_comments

    if comments_llm is None:
        monkeypatch.delenv("COMMENTS_LLM", raising=False)
    else:
        monkeypatch.setenv("COMMENTS_LLM", comments_llm)

    def unexpected_provider():
        pytest.fail("Offline comment classification must not resolve the LLM provider")

    monkeypatch.setattr(case_comments, "get_provider", unexpected_provider)
    expected = {
        2: {"СТ-001": "yellow", "СТ-003": "red", "СТ-005": "red"},
        3: {"СТ-003": "red", "СТ-004": "yellow", "СТ-005": "red"},
        4: {"СТ-002": "yellow", "СТ-003": "red", "СТ-004": "red"},
        6: {},
    }
    for period, flagged in expected.items():
        overview = build_overview(history, period)
        assert len(overview["interns"]) == 5
        assert {row["intern_id"]: row["status"] for row in overview["interns"]
                if row["status"] != "green"} == flagged


def test_provider_annotations_reach_dashboard(monkeypatch, tmp_path):
    monkeypatch.setenv("COMMENTS_LLM", "1")
    from dataclasses import replace

    from feedback.analyzers import case_comments, llm
    from feedback.schemas import BatchAnalysis, ItemAnalysis

    class Provider:
        name = "test-case"
        model = "test"

        def complete(self, system, user, schema, kind):
            assert kind == "item"
            assert "<feedback" in user
            return BatchAnalysis(items=[ItemAnalysis(
                id="0", sentiment="negative", sentiment_score=-0.8, topics=["team"],
                problems=["Проблема включения в команду"], suggestions=[], urgency="medium",
                churn_risk=False, summary="Стажёр сообщает о трудностях в команде.",
            )])

    monkeypatch.setattr(case_comments, "get_provider", Provider)
    monkeypatch.setattr(llm, "settings", replace(llm.settings, cache_dir=tmp_path))
    text = "Мне часто не сообщают о встречах команды."
    labels = case_comments.classify([{"period": 6, "comments": {"intern": {"Комментарий": text}}}])
    assert case_comments.period_label(labels[6])["risk"] is True
    signal, = case_comments.signals(labels, 6)
    assert signal["id"] == "comment-team"
    assert signal["evidence"][0]["quote"] == text



def test_team_meeting_preference_is_not_a_risk(history):
    card = build_intern(history, "СТ-002", 2)
    assert card["status"] == "green"
    assert card["periods"][-1]["comment_analysis"]["risk"] is False


def test_ai_report_uses_evidence_and_reuses_result(monkeypatch):
    from feedback.analyzers import case_comments

    calls = []

    class Provider:
        def complete(self, system, user, schema, kind):
            calls.append(user)
            assert kind == "report"
            assert '"period": 4' in user and '"value": 2' in user
            return schema(summary="Нагрузка снизилась по оценке до 2.", actions=["Уточнить загрузку."])

    monkeypatch.setattr(case_comments, "get_provider", Provider)
    case_comments._provider_report.cache_clear()
    signals = [{"evidence": [{"period": 4, "value": 2}]}]
    try:
        result = case_comments.report_for(signals, 4)
        assert result.actions == ["Уточнить загрузку."]
        assert case_comments.report_for(signals, 4) == result
        assert len(calls) == 1
    finally:
        case_comments._provider_report.cache_clear()
