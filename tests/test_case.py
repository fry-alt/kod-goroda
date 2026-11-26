"""Dashboard signals on the historical case data."""

import pytest

from feedback import store
from feedback.case import build_intern, build_overview


@pytest.fixture
def history(tmp_path, monkeypatch):
    monkeypatch.setattr(store, "DB_PATH", tmp_path / "case.db")
    store.seed()
    return store.load_history()


@pytest.mark.parametrize("period, intern_id, signal_id", [
    (3, "СТ-003", "low-intern"),
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
