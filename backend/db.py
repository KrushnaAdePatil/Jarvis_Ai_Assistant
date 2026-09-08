"""
J.A.R.V.I.S. — PostgreSQL data layer (SQLAlchemy 2.0).
Table names match the existing schema exactly, so memory persists
across deployments. Seeds a lived-in personality on first boot.
"""
from __future__ import annotations

import os
from datetime import datetime
from pathlib import Path

from sqlalchemy import (
    Boolean, DateTime, Integer, String, Text, create_engine, select, func
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, sessionmaker


def _database_url() -> str:
    url = os.environ.get("DATABASE_URL")
    if url:
        return url
    env_file = Path(__file__).resolve().parent.parent / ".env"
    if env_file.exists():
        for line in env_file.read_text().splitlines():
            if line.startswith("DATABASE_URL="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    return "postgresql://postgres:postgres@127.0.0.1:5432/app_db"


engine = create_engine(_database_url(), pool_pre_ping=True, pool_size=5, max_overflow=2)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


class Conversation(Base):
    __tablename__ = "conversations"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    role: Mapped[str] = mapped_column(Text, nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    intent: Mapped[str | None] = mapped_column(Text)
    mode: Mapped[str] = mapped_column(Text, default="jarvis")
    created_at: Mapped[datetime] = mapped_column("created_at", DateTime, default=datetime.utcnow)


class Memory(Base):
    __tablename__ = "memories"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    key: Mapped[str] = mapped_column(Text, unique=True, nullable=False)
    value: Mapped[str] = mapped_column(Text, nullable=False)
    updated_at: Mapped[datetime] = mapped_column("updated_at", DateTime, default=datetime.utcnow)


class Todo(Base):
    __tablename__ = "todos"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    task: Mapped[str] = mapped_column(Text, nullable=False)
    priority: Mapped[str] = mapped_column(Text, default="normal")
    done: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column("created_at", DateTime, default=datetime.utcnow)


class SecurityEvent(Base):
    __tablename__ = "security_events"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    level: Mapped[str] = mapped_column(Text, default="info")
    source: Mapped[str] = mapped_column(Text, default="FRIDAY")
    message: Mapped[str] = mapped_column(Text, nullable=False)
    acknowledged: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column("created_at", DateTime, default=datetime.utcnow)


class CustomCommand(Base):
    __tablename__ = "custom_commands"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    trigger_phrase: Mapped[str] = mapped_column("trigger_phrase", Text, unique=True, nullable=False)
    action: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column("created_at", DateTime, default=datetime.utcnow)


# ── Memory helpers ───────────────────────────────────────────────────────────

def get_memory(session, key: str) -> str | None:
    row = session.execute(select(Memory).where(Memory.key == key)).scalar_one_or_none()
    return row.value if row else None


def set_memory(session, key: str, value: str) -> None:
    row = session.execute(select(Memory).where(Memory.key == key)).scalar_one_or_none()
    if row:
        row.value = value
        row.updated_at = datetime.utcnow()
    else:
        session.add(Memory(key=key, value=value))
    session.commit()


_seeded = False


def ensure_seed() -> None:
    """Idempotent first-boot seeding."""
    global _seeded
    if _seeded:
        return
    _seeded = True
    try:
        with SessionLocal() as s:
            if s.execute(select(func.count(Todo.id))).scalar_one() == 0:
                s.add_all([
                    Todo(task="Review Stark Industries Q3 repulsor contracts", priority="high"),
                    Todo(task="Calibrate Mark VII flight stabilisers", priority="normal"),
                    Todo(task="Return Miss Potts' call — marked IMPORTANT", priority="high"),
                    Todo(task="Clean up the workshop (Dum-E has… opinions)", priority="low"),
                ])
            if get_memory(s, "address_as") is None:
                s.add(Memory(key="address_as", value="Sir"))
            if s.execute(select(func.count(CustomCommand.id))).scalar_one() == 0:
                s.add(CustomCommand(
                    trigger_phrase="lights out",
                    action="Dimming all lab lighting to five percent, engaging workshop lockdown, "
                           "and queuing your rain-on-window ambience. Sleep well, Sir.",
                ))
            s.commit()
    except Exception as exc:  # DB not ready yet — never crash the boot
        print(f"[JARVIS seed] {exc}")
