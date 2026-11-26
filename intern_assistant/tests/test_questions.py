import pytest
from fastapi.testclient import TestClient

from intern_assistant.main import app

client = TestClient(app)


def ask(question, topic=None):
    response = client.post("/api/ask", json={"question": question, "topic": topic})
    assert response.status_code == 200
    return response.json()


@pytest.mark.parametrize(("question", "topic"), [
    ("Как частo заполнять анкету?", "survey"),
    ("Кто заполняет опрос?", "survey"),
    ("Сколько раз за программу заполняют опрсо?", "survey"),
    ("rfr xfcnj jghjc", "survey"),
    ("Стажирвка долго идёт вообще?", "duration"),
    ("Меня взяли на полгода стажировки?", "duration"),
    ("Тройка что означает?", "scale"),
    ("Мне по шкале что ставить?", "scale"),
    ("Я не вывожу", "load"),
    ("На меня навалили задач", "load"),
    ("У меня перегрзу по задачам", "load"),
    ("Я не понмаю, какой результат ждут от меня", "tasks"),
    ("Критерии готовности задачи где?", "tasks"),
    ("Мой ментор пропал", "mentor_unavailable"),
    ("Что делать, если наставник игнорит?", "mentor_unavailable"),
    ("Как получить фидбэк?", "mentor"),
])
def test_paraphrases_have_grounded_answers(question, topic):
    reply = ask(question)
    assert reply["status"] == "answered"
    assert reply["topic"] == topic
    assert client.get("/" + reply["source"]["url"]).status_code == 200


@pytest.mark.parametrize("question", [
    "Куда отправлять анкету?",
    "Анекта анонимная?",
    "А сколько платят за полгода стажировки?",
    "Кто увидит мою оценку в анкете?",
    "Когда будет следующий опрос?",
    "Как исправить оценку в анкете?",
    "Не успеваю отправить опрос",
    "Где заказать пиццу?",
    "У меня проблемы с интернетом",
])
def test_unsupported_questions_are_not_confused_with_related_topics(question):
    reply = ask(question)
    assert reply["status"] == "unknown"
    assert reply["source"] is None


def test_ambiguous_single_word_offers_choices():
    reply = ask("анкета")
    assert reply["status"] == "clarify"
    assert len(reply["suggestions"]) >= 2


def test_draft_uses_topic_from_previous_turn():
    reply = ask("Ментор молчит")
    draft = ask("Можешь набросать пример?", reply["topic"])
    assert draft["draft"]
    assert draft["topic"] == "mentor_unavailable"
    assert ask("Можешь набросать пример?")["status"] == "unknown"


def test_combined_question_answers_known_part_and_marks_gap():
    reply = ask("Сколько идёт стажирвка и где взять анкету?")
    duration, link = reply["parts"]
    assert duration["topic"] == "duration"
    assert link["status"] == "unknown"
    assert "ссылку" in link["answer"]
