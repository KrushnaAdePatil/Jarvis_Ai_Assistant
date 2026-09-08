"""
FRIDAY Telemetry Engine — reads REAL host statistics from /proc (CPU %,
memory, uptime) and simulates the subsystems a browser cannot reach
(network throughput, GPU thermals, process table with remote kill).
"""
from __future__ import annotations

import math
import os
import platform
import random
import shutil
import socket
import time

_prev_cpu: list[int] | None = None


def _read_cpu_times() -> list[int]:
    try:
        with open("/proc/stat") as fh:
            parts = fh.readline().split()[1:8]
            return [int(p) for p in parts]
    except Exception:
        return [0] * 7


def cpu_percent() -> int:
    global _prev_cpu
    now = _read_cpu_times()
    if _prev_cpu is None:
        _prev_cpu = now
        try:
            cores = max(1, os.cpu_count() or 1)
            return min(100, int(os.getloadavg()[0] / cores * 100))
        except Exception:
            return 5
    idle_delta = (now[3] + now[4]) - (_prev_cpu[3] + _prev_cpu[4])
    total_delta = sum(now) - sum(_prev_cpu)
    _prev_cpu = now
    if total_delta <= 0:
        return 0
    return max(0, min(100, round((1 - idle_delta / total_delta) * 100)))


def _mem_info() -> tuple[int, int]:
    try:
        info: dict[str, int] = {}
        with open("/proc/meminfo") as fh:
            for line in fh:
                key, _, rest = line.partition(":")
                info[key.strip()] = int(rest.strip().split()[0]) * 1024
        total = info.get("MemTotal", 0)
        avail = info.get("MemAvailable", 0)
        return total - avail, total
    except Exception:
        return 2 * 10**9, 8 * 10**9


def _uptime() -> int:
    try:
        with open("/proc/uptime") as fh:
            return int(float(fh.readline().split()[0]))
    except Exception:
        return 0


def _link_speed() -> dict:
    t = time.time()
    down = max(24, round(142 + math.sin(t / 17) * 42 + (random.random() - 0.5) * 26))
    up = max(8, round(down * (0.16 + random.random() * 0.05)))
    return {"down": down, "up": up}


def get_telemetry() -> dict:
    used, total = _mem_info()
    cpu = cpu_percent()
    disk = shutil.disk_usage("/")
    host = "".join(c for c in socket.gethostname().upper() if c.isalnum() or c == "-") or "STARK-1"
    return {
        "ts": int(time.time() * 1000),
        "cpu": cpu,
        "mem": {"usedGB": round(used / 1e9, 1), "totalGB": round(total / 1e9, 1),
                "percent": round(used / total * 100) if total else 0},
        "disk": {"usedGB": round(disk.used / 1e9, 1), "totalGB": round(disk.total / 1e9, 1),
                 "percent": round(disk.used / disk.total * 100) if disk.total else 0},
        "net": _link_speed(),
        "gpu": {"temp": round(42 + cpu * 0.18 + (random.random() - 0.5) * 3),
                "load": max(4, min(99, round(cpu * 0.7 + (random.random() - 0.5) * 12)))},
        "uptime": _uptime(),
        "host": host,
        "platform": f"{platform.system()} {platform.machine()}",
        "cores": os.cpu_count() or 1,
        "loadavg": [round(n, 2) for n in (os.getloadavg() if hasattr(os, "getloadavg") else (0, 0, 0))],
    }


# ── Simulated process table ──────────────────────────────────────────────────

_BASELINE: list[tuple[str, int]] = [
    ("vision-render", 412), ("chrome", 388), ("jarvis-core", 164), ("code", 296),
    ("postgres", 96), ("friday-daemon", 48), ("docker", 142), ("spotify", 61),
    ("kernel_task", 18), ("slack", 77), ("redis-server", 24), ("nginx", 16),
]

_procs: list[dict] | None = None


def get_processes() -> list[dict]:
    global _procs
    if _procs is None:
        _procs = [
            {"pid": 1200 + i * 137, "name": name, "cpu": round(2 + random.random() * 14, 1),
             "mem": mem, "status": "running"}
            for i, (name, mem) in enumerate(_BASELINE)
        ]
        _procs[0]["pid"] = 4242
    for p in _procs:
        p["cpu"] = round(max(0.2, min(97, p["cpu"] + (random.random() - 0.5) * 6)), 1)
    return sorted(_procs, key=lambda p: -p["cpu"])


_PROTECTED = {"jarvis-core", "friday-daemon", "kernel_task", "postgres"}


def kill_process(query: str) -> dict:
    get_processes()
    q = query.lower().strip()
    for i, p in enumerate(_procs or []):
        if q in p["name"].lower() or str(p["pid"]) == q:
            if p["name"] in _PROTECTED:
                return {"ok": False,
                        "message": f"Termination of {p['name']} is restricted — it is mission-critical."}
            victim = _procs.pop(i)
            return {"ok": True,
                    "message": f"Process {victim['name']} (PID {victim['pid']}) terminated. Resources reclaimed."}
    return {"ok": False, "message": f'No process matching "{query}" was found in the active table.'}
