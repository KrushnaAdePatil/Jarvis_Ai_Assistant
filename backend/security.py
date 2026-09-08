"""
FRIDAY Security Engine — generates network/host threat telemetry, persists
events to PostgreSQL, and produces full-spectrum scan reports.
"""
from __future__ import annotations

import random

from sqlalchemy import select

from db import SessionLocal, SecurityEvent

INFO_FINDINGS = [
    "Firewall active — 14 rule sets enforced, 0 policy violations",
    "Kernel integrity check passed for 1,284 system modules",
    "No rootkit signatures detected in ring-0 scan",
    "Encrypted volume verification complete — AES-256 nominal",
    "TLS certificate chain validated for all outbound channels",
    "DNS-over-HTTPS tunnel stable, no cache-poisoning attempts",
    "Arc reactor containment field holding at 100% — no anomalies",
]


def _ip() -> str:
    return f"{random.choice([45, 91, 103, 185, 193, 203])}.{random.choice([12, 34, 87, 220])}" \
           f".{random.randint(0, 254)}.{random.randint(0, 254)}"


WARNING_FINDINGS = [
    lambda: f"Failed SSH login burst from {_ip()} — 3 attempts, source blacklisted",
    lambda: f"Unusual outbound connection to {_ip()}:4444 terminated and logged",
    lambda: f"Port 3389 probe detected from {_ip()} — silent drop engaged",
    lambda: "TLS downgrade attempt intercepted on gateway interface",
    lambda: "Unrecognised USB device signature presented on bus 002 — access denied",
    lambda: "Process anomaly: unexpected fork bomb pattern quarantined",
    lambda: "ARP table inconsistency on subnet 192.168.1.0/24 — monitoring",
]

CRITICAL_FINDINGS = [
    lambda: f"Intrusion attempt escalated: {_ip()} probing privileged ports — countermeasures deployed",
    lambda: "Memory corruption signature blocked in unprivileged process — snapshot archived",
]


def recent_events(limit: int = 40) -> list[dict]:
    with SessionLocal() as s:
        rows = s.execute(
            select(SecurityEvent).order_by(SecurityEvent.id.desc()).limit(limit)
        ).scalars().all()
        return [
            {"id": r.id, "level": r.level, "source": r.source, "message": r.message,
             "acknowledged": r.acknowledged, "createdAt": r.created_at.isoformat()}
            for r in rows
        ]


def acknowledge(event_id: int | None = None, all_events: bool = False) -> None:
    with SessionLocal() as s:
        if all_events:
            for r in s.execute(select(SecurityEvent).where(SecurityEvent.acknowledged.is_(False))).scalars():
                r.acknowledged = True
        elif event_id is not None:
            r = s.get(SecurityEvent, event_id)
            if r:
                r.acknowledged = True
        s.commit()


def run_scan() -> dict:
    rows: list[dict] = []
    infos = random.sample(INFO_FINDINGS, k=random.randint(2, 4))
    rows += [{"level": "info", "source": "FRIDAY", "message": m} for m in infos]

    warn_count = 0 if random.random() < 0.25 else random.randint(1, 3)
    warnings = random.sample(WARNING_FINDINGS, k=min(warn_count, len(WARNING_FINDINGS)))
    rows += [{"level": "warning", "source": "FRIDAY", "message": w()} for w in warnings]

    threat = "info"
    if warn_count > 1:
        threat = "warning"
    if random.random() < 0.14:
        rows.append({"level": "critical", "source": "FRIDAY", "message": random.choice(CRITICAL_FINDINGS)()})
        threat = "critical"
    elif warn_count:
        threat = "warning"

    with SessionLocal() as s:
        for r in rows:
            s.add(SecurityEvent(**r))
        s.commit()

    if threat == "critical":
        summary = (f"Scan complete, Sir. I have detected and neutralised a critical intrusion attempt, "
                   f"alongside {warn_count} lower-priority anomalies. All countermeasures holding — you are safe.")
    elif warn_count:
        summary = (f"Scan complete. {warn_count} minor anomal{'y' if warn_count == 1 else 'ies'} detected and "
                   f"contained — nothing that troubles me, Sir. Perimeter is secure.")
    else:
        summary = "Full-spectrum diagnostic complete. Zero threats detected across all vectors. The house is clean, Sir."

    return {"events": rows, "summary": summary, "threatLevel": threat}


def seed_posture() -> None:
    try:
        with SessionLocal() as s:
            existing = s.execute(select(SecurityEvent.id).limit(1)).first()
            if existing:
                return
            s.add_all([
                SecurityEvent(level="info", source="FRIDAY",
                              message="Perimeter defence grid initialised — 5 sensors online", acknowledged=True),
                SecurityEvent(level="info", source="FRIDAY",
                              message="Firewall active — 14 rule sets enforced, 0 policy violations", acknowledged=True),
                SecurityEvent(level="warning", source="FRIDAY",
                              message=f"Failed SSH login burst from {_ip()} — 3 attempts, source blacklisted"),
            ])
            s.commit()
    except Exception as exc:
        print(f"[FRIDAY seed] {exc}")
