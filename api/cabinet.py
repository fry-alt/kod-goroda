"""Кабинет стажёра и инструменты HR: ручки, которые ждёт web/shared/store.js.

Без них фронт тоже работает, но хранит всё в localStorage одного браузера. С ними стажёр с телефона и HR с ноутбука
видят одно и то же: каждая запись поднимает версию, дашборд по опросу /api/version перечитывает списки.

  GET/PUT  /api/onboarding                 памятка (как web/data/onboarding.json)
  GET/POST /api/checklist/{intern_id}      {"done": [ids]}
  GET/POST /api/kudos                      похвала / зона роста стажёру
  GET/POST /api/feedback-requests          запросы ОС от стажёра
  GET/POST /api/meetings                   встречи 1:1, знакомство с командой
  GET/POST /api/intern-requests            обращения стажёров
  POST     /api/huntflow/sync              демо: без ключа Huntflow только записываем
  POST     /api/remind                     демо: напоминание заполнить анкету
"""
from __future__ import annotations

import json
from typing import Optional

from fastapi import APIRouter, HTTPException, Request

from feedback import store
from feedback.config import ROOT

router = APIRouter(prefix="/api")

MAX_BYTES = 64_000
ONBOARDING_FILE = ROOT / "web" / "data" / "onboarding.json"

LISTS = {  # путь → подпись для last_event
    "kudos": "обратная связь стажёру",
    "feedback-requests": "запрос обратной связи",
    "meetings": "встреча",
    "intern-requests": "обращение стажёра",
}


async def _body(request: Request) -> dict:
    raw = await request.body()
    if len(raw) > MAX_BYTES:
        raise HTTPException(413, f"слишком большой запрос: {len(raw)} байт, максимум {MAX_BYTES}")
    try:
        data = json.loads(raw or b"{}")
    except ValueError:
        raise HTTPException(400, "нужен JSON")
    if not isinstance(data, dict):
        raise HTTPException(400, "нужен JSON-объект")
    return data


# ---------- памятка ----------

@router.get("/onboarding")
def get_onboarding():
    saved = store.get_record("onboarding", "memo")
    if saved:
        saved.pop("id", None), saved.pop("at", None)
        return saved
    return json.loads(ONBOARDING_FILE.read_text(encoding="utf-8"))


@router.put("/onboarding")
async def put_onboarding(request: Request):
    data = await _body(request)
    store.put_record("onboarding", {**data, "id": "memo"}, "памятка")
    return {"ok": True}


# ---------- чек-лист адаптации ----------

@router.get("/checklist/{intern_id}")
def get_checklist(intern_id: str):
    rec = store.get_record("checklist", intern_id)
    return {"intern_id": intern_id, "done": rec["done"] if rec else []}


@router.post("/checklist/{intern_id}")
async def post_checklist(intern_id: str, request: Request):
    done = (await _body(request)).get("done", [])
    if not isinstance(done, list):
        raise HTTPException(400, "done — список id пунктов")
    store.put_record("checklist", {"id": intern_id, "intern_id": intern_id, "done": [str(x) for x in done]},
                     "чек-лист адаптации")
    return {"intern_id": intern_id, "done": done}


# ---------- списки: похвала, запросы ОС, встречи, обращения ----------

def _list_routes(kind: str, label: str) -> None:
    @router.get(f"/{kind}", name=f"list_{kind}")
    def list_items(intern_id: Optional[str] = None):
        return store.list_records(kind, intern_id)

    @router.post(f"/{kind}", name=f"add_{kind}")
    async def add_item(request: Request):
        return store.put_record(kind, await _body(request), label)


for _kind, _label in LISTS.items():
    _list_routes(_kind, _label)


# ---------- внешние системы: в прототипе только журнал ----------

@router.post("/huntflow/sync")
async def huntflow_sync(request: Request):
    data = await _body(request)
    if not data.get("intern_id"):
        raise HTTPException(400, "нужен intern_id")
    rec = store.put_record("huntflow", {**data, "id": f"{data['intern_id']}|{data.get('period', '')}"}, "Huntflow")
    return {"ok": True, "demo": True, "at": rec["at"]}


@router.post("/remind")
async def remind(request: Request):
    rec = store.put_record("remind", await _body(request), "напоминание об анкете")
    return {"ok": True, "demo": True, "at": rec["at"]}
