from contextlib import ExitStack
from urllib.parse import quote

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from api.main import app

ROOM = "/ws/call/" + quote("СТ-002")


def join(socket):
    socket.send_json({"type": "join", "groupId": "СТ-002", "mic": True, "cam": False})
    joined = socket.receive_json()
    assert joined["type"] == "joined"
    assert joined["question"] is None
    return joined


def test_signaling_chat_and_disconnect():
    client = TestClient(app)
    with client.websocket_connect(ROOM + "?name=HR") as hr:
        first = join(hr)
        assert first["peers"] == first["chat"] == []
        with client.websocket_connect(ROOM + "?name=" + quote("Стажёр")) as intern:
            intern.send_text("{")
            intern.send_json([])
            intern.send_json({"type": "signal", "to": first["you"], "data": {}})
            second = join(intern)
            assert second["peers"] == [
                {"id": first["you"], "name": "HR", "mic": True, "cam": False}
            ]
            assert hr.receive_json() == {"type": "peer-joined", "id": second["you"],
                                         "name": "Стажёр", "mic": True, "cam": False}

            offer = {"description": {"type": "offer", "sdp": "example"}}
            hr.send_json({"type": "signal", "to": second["you"], "data": offer})
            assert intern.receive_json() == {"type": "signal", "from": first["you"], "data": offer}

            intern.send_json({"type": "state", "mic": False, "cam": True})
            assert hr.receive_json() == {"type": "state", "id": second["you"],
                                         "mic": False, "cam": True}

            hr.send_json({"type": "chat", "text": "  Тест\n\u202e " + "а" * 500})
            chat = hr.receive_json()
            assert chat == intern.receive_json()
            assert chat["type"] == "chat"
            assert chat["from"] == first["you"]
            assert chat["name"] == "HR"
            assert isinstance(chat["id"], int)
            assert isinstance(chat["at"], int)
            assert chat["text"] == "Тест " + "а" * 495

        assert hr.receive_json() == {"type": "peer-left", "id": second["you"]}
        with client.websocket_connect(ROOM) as newcomer:
            joined = join(newcomer)
            assert joined["chat"] == [chat]
            assert hr.receive_json()["type"] == "peer-joined"
        assert hr.receive_json() == {"type": "peer-left", "id": joined["you"]}
        hr.send_json({"type": "leave"})
        with pytest.raises(WebSocketDisconnect):
            hr.receive_json()

    with client.websocket_connect(ROOM) as newcomer:
        joined = join(newcomer)
        assert joined["chat"] == joined["peers"] == []


def test_chat_rate_and_room_capacity():
    client = TestClient(app)
    with ExitStack() as stack:
        sockets = []
        for index in range(3):
            socket = stack.enter_context(client.websocket_connect(ROOM))
            peer = join(socket)
            assert len(peer["peers"]) == index
            for other in sockets:
                assert other.receive_json()["type"] == "peer-joined"
            sockets.append(socket)

        with client.websocket_connect(ROOM) as extra:
            extra.send_json({"type": "join", "mic": True, "cam": True})
            assert extra.receive_json() == {"type": "error", "message": "Комната заполнена"}
            with pytest.raises(WebSocketDisconnect):
                extra.receive_json()

        for index in range(8):
            sockets[0].send_json({"type": "chat", "text": str(index)})
            for socket in sockets:
                assert socket.receive_json()["text"] == str(index)
        sockets[0].send_json({"type": "chat", "text": "blocked"})
        assert sockets[0].receive_json() == {"type": "chat-limit"}


def test_ice_route_precedes_static_mount():
    response = TestClient(app).get("/api/call/ice")
    assert response.status_code == 200
    assert response.json()["iceServers"][0]["urls"] == [
        "stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"
    ]
