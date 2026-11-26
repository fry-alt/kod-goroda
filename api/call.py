"""In-memory WebRTC signaling and chat for the demo."""
import json
import re
import secrets
import time
from collections import deque
from dataclasses import dataclass, field

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

router = APIRouter()
CHAT_MAX = 500
CHAT_KEEP = 100
CHAT_RATE = 8
CHAT_WINDOW = 10
ROOM_CAPACITY = 3
MESSAGE_MAX = 64 * 1024

CONTROL_CHARS = re.compile(r"[\x00-\x1f\x7f\u200b-\u200f\u2028-\u202e\u2066-\u2069\ud800-\udfff]")


@dataclass
class Peer:
    ws: WebSocket
    name: str
    mic: bool
    cam: bool
    chat_times: deque[float] = field(default_factory=deque)

    def presence(self, peer_id: str) -> dict:
        return {"id": peer_id, "mic": self.mic, "cam": self.cam, "name": self.name}


@dataclass
class Room:
    peers: dict[str, Peer] = field(default_factory=dict)
    chat: deque[dict] = field(default_factory=lambda: deque(maxlen=CHAT_KEEP))
    next_message_id: int = 1


rooms: dict[str, Room] = {}


def clean_text(value: str, limit: int) -> str:
    return " ".join(CONTROL_CHARS.sub(" ", value).split())[:limit]


async def send(ws: WebSocket, message: dict):
    try:
        await ws.send_json(message)
    except (OSError, RuntimeError, ValueError, WebSocketDisconnect):
        # The recipient can disconnect while another socket is sending to it.
        pass


async def broadcast(room: Room, message: dict, skip: str | None = None):
    for peer_id, peer in list(room.peers.items()):
        if peer_id != skip:
            await send(peer.ws, message)


@router.websocket("/ws/call/{room}")
async def call(ws: WebSocket, room: str, name: str = "Участник"):
    await ws.accept()
    me = secrets.token_hex(8)
    name = clean_text(name, 80) or "Участник"
    session = None
    peer = None
    leaving = False

    try:
        while True:
            frame = await ws.receive()
            if frame["type"] == "websocket.disconnect":
                break
            raw = frame.get("text")
            if raw is None or len(raw) > MESSAGE_MAX:
                continue
            try:
                message = json.loads(raw)
            except (ValueError, RecursionError):
                continue
            if not isinstance(message, dict):
                continue

            kind = message.get("type")
            if kind == "leave":
                leaving = True
                break
            if kind == "join" and peer is None:
                session = rooms.setdefault(room, Room())
                if len(session.peers) >= ROOM_CAPACITY:
                    await send(ws, {"type": "error", "message": "Комната заполнена"})
                    await ws.close(code=1008)
                    return
                existing = list(session.peers.items())
                peers = [other.presence(peer_id) for peer_id, other in existing]
                peer = Peer(ws, name, message.get("mic") is True, message.get("cam") is True)
                session.peers[me] = peer
                await send(ws, {"type": "joined", "you": me, "peers": peers,
                                "chat": list(session.chat), "question": None})
                for _, other in existing:
                    await send(other.ws, {"type": "peer-joined", **peer.presence(me)})
            elif peer is None:
                continue
            elif kind == "signal":
                target = message.get("to")
                data = message.get("data")
                if isinstance(target, str) and target in session.peers and isinstance(data, dict):
                    try:
                        json.dumps(data, allow_nan=False, ensure_ascii=False).encode()
                    except (ValueError, RecursionError):
                        continue
                    await send(session.peers[target].ws, {"type": "signal", "from": me, "data": data})
            elif kind == "state":
                peer.mic = message.get("mic") is True
                peer.cam = message.get("cam") is True
                await broadcast(session, {"type": "state", "id": me, "mic": peer.mic, "cam": peer.cam}, skip=me)
            elif kind == "chat":
                value = message.get("text")
                text = clean_text(value, CHAT_MAX) if isinstance(value, str) else ""
                if not text:
                    continue
                now = time.monotonic()
                while peer.chat_times and now - peer.chat_times[0] >= CHAT_WINDOW:
                    peer.chat_times.popleft()
                if len(peer.chat_times) >= CHAT_RATE:
                    await send(ws, {"type": "chat-limit"})
                    continue
                peer.chat_times.append(now)
                item = {"type": "chat", "id": session.next_message_id, "from": me,
                        "name": peer.name, "text": text, "at": time.time_ns() // 1_000_000}
                session.next_message_id += 1
                session.chat.append(item)
                await broadcast(session, item)
    except WebSocketDisconnect:
        pass
    finally:
        if peer is not None:
            del session.peers[me]
            if session.peers:
                await broadcast(session, {"type": "peer-left", "id": me})
            else:
                del rooms[room]
        if leaving:
            await ws.close()


@router.get("/api/call/ice")
def ice():
    return {"iceServers": [{"urls": ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"]}]}
