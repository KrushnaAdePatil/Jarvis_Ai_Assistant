"""
J.A.R.V.I.S. — Python backend (FastAPI).

Run standalone (serves the HUD as well):
    python3 -m uvicorn backend.main:app --host 0.0.0.0 --port 8000
or from this directory:
    python3 -m uvicorn main:app --port 8000

When hosted behind the Next.js shell, Next rewrites /api/* to this service.
"""
from __future__ import annotations

import sys
from pathlib import Path

# Allow `python3 -m uvicorn backend.main:app` from the project root.
sys.path.insert(0, str(Path(__file__).resolve().parent))

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

import brain
import security
import services
import telemetry
from db import SessionLocal, Todo, ensure_seed
from security import seed_posture
from sqlalchemy import select, desc
from telemetry import kill_process

app = FastAPI(title="J.A.R.V.I.S.", version="48.2")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def _startup() -> None:
    ensure_seed()
    seed_posture()


@app.get("/api/health")
def health() -> dict:
    return {"ok": True, "engine": "python", "system": "J.A.R.V.I.S.", "version": "48.2"}


@app.post("/api/command")
async def command(req: Request) -> dict:
    try:
        body = await req.json()
    except Exception:
        body = {}
    text = (body.get("text") or "").strip()
    if not text:
        return {"error": "Empty command"}
    ctx = body.get("context") or {}
    try:
        result = brain.process_command(text, ctx)
    except Exception as exc:
        print(f"[JARVIS brain] {exc}")
        result = {
            "reply": "Apologies, Sir — I encountered a subsystem fault processing that. "
                     "Perhaps rephrase while I recalibrate.",
            "intent": "error", "mood": "concerned",
        }
    brain.archive_exchange(text, result, ctx.get("mode", "jarvis"))
    return result


@app.get("/api/telemetry")
def get_telemetry() -> dict:
    data = telemetry.get_telemetry()
    data["processes"] = telemetry.get_processes()
    return data


@app.get("/api/weather")
def weather(city: str = "London") -> dict:
    return services.get_weather(city)


@app.get("/api/news")
def news() -> dict:
    return {"items": services.get_news(10)}


@app.get("/api/briefing")
def briefing() -> dict:
    ensure_seed()
    return {"text": brain.build_briefing("Sir")}


@app.get("/api/history")
def history(q: str | None = None) -> dict:
    return {"items": brain.recent_conversations(80, q)}


# ── Tasks ────────────────────────────────────────────────────────────────────

def _todo_dict(t: Todo) -> dict:
    return {"id": t.id, "task": t.task, "priority": t.priority, "done": t.done,
            "createdAt": t.created_at.isoformat()}


@app.get("/api/todos")
def todos_list() -> dict:
    ensure_seed()
    with SessionLocal() as s:
        rows = s.execute(select(Todo).order_by(desc(Todo.created_at)).limit(30)).scalars().all()
        return {"items": [_todo_dict(t) for t in rows]}


@app.post("/api/todos")
async def todos_add(req: Request) -> dict:
    body = await req.json()
    task = (body.get("task") or "").strip()
    if not task:
        return {"error": "task required"}
    with SessionLocal() as s:
        t = Todo(task=task, priority=body.get("priority") or "normal")
        s.add(t)
        s.commit()
        s.refresh(t)
        return _todo_dict(t)


@app.patch("/api/todos")
async def todos_update(req: Request) -> dict:
    body = await req.json()
    tid = body.get("id")
    if tid is None:
        return {"error": "id required"}
    with SessionLocal() as s:
        t = s.get(Todo, int(tid))
        if not t:
            return {"error": "not found"}
        if body.get("remove"):
            s.delete(t)
            s.commit()
            return {"ok": True}
        if isinstance(body.get("done"), bool):
            t.done = body["done"]
            s.commit()
            s.refresh(t)
            return _todo_dict(t)
    return {"error": "nothing to update"}


# ── Alerts / security ──────────────────────────────────────────────────────

@app.get("/api/alerts")
def alerts_list() -> dict:
    seed_posture()
    return {"items": security.recent_events(40)}


@app.patch("/api/alerts")
async def alerts_ack(req: Request) -> dict:
    body = await req.json()
    security.acknowledge(body.get("id"), bool(body.get("all")))
    return {"ok": True}


@app.post("/api/security")
async def security_action(req: Request) -> dict:
    try:
        body = await req.json()
    except Exception:
        body = {}
    if body.get("action") == "kill":
        q = str(body.get("pid")) if body.get("pid") is not None else (body.get("name") or "")
        return kill_process(q)
    return security.run_scan()


# ── Standalone hosting of the vanilla HUD ──────────────────────────────────

_HUD_DIR = Path(__file__).resolve().parent.parent / "public" / "hud"
if _HUD_DIR.exists():
    app.mount("/", StaticFiles(directory=str(_HUD_DIR), html=True), name="hud")
