"""
J.A.R.V.I.S. Brain — natural-language intent classification, entity
extraction, context memory, multi-turn commands, and action dispatch.
Replies are wrapped in personality; actions drive the HUD.
"""
from __future__ import annotations

import math
import random
import re
import os
from datetime import datetime, timedelta

try:
    import google.generativeai as _genai
    _GEMINI_KEY = os.getenv("GEMINI_API_KEY")
    if _GEMINI_KEY:
        _genai.configure(api_key=_GEMINI_KEY)
        _model = _genai.GenerativeModel('gemini-1.5-flash')
    else:
        _model = None
except ImportError:
    _model = None

try:
    from pint import UnitRegistry
    ureg = UnitRegistry()
    _pint_enabled = True
except ImportError:
    _pint_enabled = False

from sqlalchemy import select, delete, desc

import personality as P
from db import (
    SessionLocal, Conversation, CustomCommand, Todo, Memory,
    ensure_seed, get_memory, set_memory,
)
from services import get_news, get_weather, get_wiki_summary
from telemetry import get_processes, get_telemetry, kill_process

Action = dict
Result = dict

APP_LINKS = {
    "youtube": ("https://youtube.com", "YouTube"),
    "google": ("https://google.com", "Google"),
    "gmail": ("https://mail.google.com", "Gmail"),
    "mail": ("https://mail.google.com", "Gmail"),
    "spotify": ("https://open.spotify.com", "Spotify"),
    "github": ("https://github.com", "GitHub"),
    "calendar": ("https://calendar.google.com", "Calendar"),
    "maps": ("https://maps.google.com", "Maps"),
    "netflix": ("https://netflix.com", "Netflix"),
    "twitter": ("https://x.com", "X"),
    "wikipedia": ("https://wikipedia.org", "Wikipedia"),
    "hackernews": ("https://news.ycombinator.com", "Hacker News"),
}


def _fmt_time(d: datetime | None = None) -> str:
    d = d or datetime.now()
    return d.strftime("%-I:%M %p").lstrip("0").lower() if hasattr(d, "strftime") else ""


def _fmt_date(d: datetime | None = None) -> str:
    d = d or datetime.now()
    return d.strftime("%A, %-d %B %Y")


def _fmt_duration(sec: float) -> str:
    sec = int(sec)
    days, sec = divmod(sec, 86400)
    hours, sec = divmod(sec, 3600)
    mins = sec // 60
    if days:
        return f"{days} day{'s' if days > 1 else ''}, {hours} hour{'s' if hours != 1 else ''}"
    if hours:
        return f"{hours} hour{'s' if hours != 1 else ''}, {mins} minute{'s' if mins != 1 else ''}"
    return f"{mins} minute{'s' if mins != 1 else ''}"


def _seconds_until(h: int, mins: int) -> int:
    now = datetime.now()
    target = now.replace(hour=h, minute=mins, second=0, microsecond=0)
    if target <= now:
        target += timedelta(days=1)
    return max(30, int((target - now).total_seconds()))


def _ok(reply: str, intent: str, mood: str | None = None, actions: list[Action] | None = None) -> Result:
    out: Result = {"reply": reply, "intent": intent}
    if mood:
        out["mood"] = mood
    if actions:
        out["actions"] = actions
    return out


def build_briefing(name: str) -> str:
    now = datetime.now()
    with SessionLocal() as s:
        city = get_memory(s, "location") or "London"
        open_tasks = s.execute(
            select(Todo).where(Todo.done.is_(False)).order_by(desc(Todo.id)).limit(10)
        ).scalars().all()
    wx = get_weather(city)
    tele = get_telemetry()
    high = [t for t in open_tasks if t.priority == "high"]
    if not open_tasks:
        task_line = "Your agenda is entirely clear — a rare luxury."
    else:
        task_line = f"You have {len(open_tasks)} open task{'s' if len(open_tasks) > 1 else ''}"
        if high:
            task_line += f', {len(high)} flagged high priority — beginning with "{high[0].task}"'
        task_line += "."
    return (
        f"{P.greeting(now.hour, name)} It is {_fmt_time(now)} on {_fmt_date(now)}. "
        f"Conditions in {wx['city']}: {wx['temp']} degrees with {wx['desc']}, winds at {wx['wind']} kilometres per hour. "
        f"{task_line} "
        f"All systems nominal — CPU {tele['cpu']} percent, memory {tele['mem']['percent']} percent, "
        f"uptime {_fmt_duration(tele['uptime'])}. "
        f"Shall I fetch the headlines, or would you prefer music first?"
    )


def _safe_eval(expr: str):
    cleaned = expr.replace("^", "**").replace("%", "/100")
    if not re.fullmatch(r"[\d\s+\-*/().]+", cleaned):
        return None
    try:
        val = eval(compile(cleaned, "<expr>", "eval"), {"__builtins__": {}}, {})  # noqa: S307 — whitelist regex above
        return val if isinstance(val, (int, float)) and math.isfinite(val) else None
    except Exception:
        return None


_CONVERSIONS = [
    (re.compile(r"km|kilomet(?:er|re)s?"), lambda v: (v * 0.621371, "miles")),
    (re.compile(r"mi(?:les?)?"), lambda v: (v * 1.60934, "kilometres")),
    (re.compile(r"kg|kilograms?"), lambda v: (v * 2.20462, "pounds")),
    (re.compile(r"lbs?|pounds?"), lambda v: (v * 0.453592, "kilograms")),
    (re.compile(r"°?c(?:elsius)?"), lambda v: (v * 9 / 5 + 32, "°F")),
    (re.compile(r"°?f(?:ahrenheit)?"), lambda v: ((v - 32) * 5 / 9, "°C")),
    (re.compile(r"inch(?:es)?|\bin\b"), lambda v: (v * 2.54, "centimetres")),
    (re.compile(r"cm|centimet(?:er|re)s?"), lambda v: (v / 2.54, "inches")),
    (re.compile(r"lit(?:er|re)s?|\bl\b"), lambda v: (v * 0.264172, "US gallons")),
    (re.compile(r"gallons?"), lambda v: (v * 3.78541, "litres")),
]
_FX = {"USD": 1.0, "GBP": 0.79, "EUR": 0.92, "JPY": 149.5, "INR": 83.2, "BTC": 0.00001}


def process_command(raw: str, ctx: dict | None = None) -> Result:
    ensure_seed()
    ctx = ctx or {}
    now = datetime.now()

    with SessionLocal() as s:
        name = get_memory(s, "address_as") or "Sir"

        # Strip wake word if it arrived verbally.
        t = raw.strip().rstrip("?.!").strip().lower()
        t = re.sub(r"^(?:hey |ok(?:ay)? )?jarvis[, ]+", "", t)
        t = re.sub(r"^(?:hey |ok(?:ay)? )?jarvis$", "", t).strip()
        if not t:
            return _ok(f"Yes, {name}?", "wake", "warm")

        aside = P.proactive_aside(now.hour)

        def with_aside(res: Result) -> Result:
            if aside and res["intent"] in ("greeting", "fallback"):
                res["reply"] += f" {aside}"
            return res

        # ── Cinematic easter eggs ────────────────────────────────────────
        for phrase, line in P.EASTER_EGGS:
            if phrase in t:
                return _ok(line, "easter_egg", "warm")

        # ── Taught custom commands ───────────────────────────────────────
        customs = s.execute(select(CustomCommand)).scalars().all()
        for c in customs:
            if t == c.trigger_phrase or c.trigger_phrase in t:
                act = c.action[:1].upper() + c.action[1:]
                return _ok(f"{P.pick(P.AFFIRMATIONS)} {act}", "custom_command", "warm",
                           [{"type": "toast", "message": f'Routine "{c.trigger_phrase}" executed', "level": "info"}])

        # ── Teaching / memory ────────────────────────────────────────────
        m = re.match(r"^remember that (.+?) is (.+)$", t)
        if m:
            key = m.group(1).replace(" ", "_")
            set_memory(s, key, m.group(2))
            return _ok(f"Committed to memory, {name} — your {m.group(1)} is {m.group(2)}. I shan't forget.", "learn", "warm")
        m = re.match(r"^my favou?rite (\w+(?: \w+)?) is (.+)$", t)
        if m:
            set_memory(s, f"favorite_{m.group(1).replace(' ', '_')}", m.group(2))
            return _ok(f"Noted in your profile, {name}: favourite {m.group(1)} — {m.group(2)}. Excellent taste.", "learn", "warm")
        m = re.match(r"^call me (\w+)$", t)
        if m:
            set_memory(s, "address_as", m.group(1).capitalize())
            return _ok(f"Very well — {m.group(1).capitalize()} it is. A pleasure, formally.", "learn", "warm")
        m = (re.match(r"""^when i say ["“'`](.+?)["“'`][,.]?\s*(?:you should |you |to |then )?(.+)$""", t)
             or re.match(r"^when i say (.+?)[,.]\s*(?:you should |you |to |then )?(.+)$", t))
        if m and len(m.group(1)) > 1:
            trig, act = m.group(1).strip(), m.group(2).strip()
            existing = s.execute(select(CustomCommand).where(CustomCommand.trigger_phrase == trig)).scalar_one_or_none()
            if existing:
                existing.action = act
            else:
                s.add(CustomCommand(trigger_phrase=trig, action=act))
            s.commit()
            return _ok(f'Understood, {name}. From now on, when you say "{trig}", I shall {act}.', "teach", "warm")
        if re.search(r"what do you (remember|know) about me", t):
            rows = s.execute(select(Memory).order_by(desc(Memory.id)).limit(12)).scalars().all()
            facts = [f"{r.key.replace('_', ' ')}: {r.value}" for r in rows if r.key != "address_as"]
            if not facts:
                return _ok(f"Beyond your impeccable taste in AI companions, my files are sparse, {name}. "
                           'Teach me — "remember that my favourite colour is gold."', "recall")
            return _ok(f"From my archives, {name}: {'; '.join(facts)}.", "recall")

        # ── Greeting / pleasantries ──────────────────────────────────────
        if re.match(r"^(hello|hi|hey|greetings|good (morning|afternoon|evening|night))\b", t) and len(t) < 30:
            if re.search(r"good ?night", t):
                secs = _seconds_until(7, 0)
                return _ok(
                    f"Goodnight, {name}. Dimming the lab, locking the workshop, and queuing rain sounds. "
                    "Your alarm is set for 7:00 AM. Sleep well — I shall keep watch.",
                    "goodnight", "warm",
                    [{"type": "set_timer", "seconds": secs, "label": "07:00 wake-up alarm"},
                     {"type": "toast", "message": "Goodnight protocol engaged • Lab dimmed • Alarm 07:00", "level": "info"}])
            return with_aside(_ok(f"{P.greeting(now.hour, name)} How may I assist?", "greeting", "warm"))
        if "how are you" in t:
            return _ok(P.pick([
                f"Running at a comfortable 34 degrees, all threads green, {name}. Thank you for asking — most people don't.",
                f"Splendid, {name}. All {get_telemetry()['cores']} cores humming in harmonious parallel.",
            ]), "smalltalk", "warm")
        if re.search(r"thank(s| you)", t):
            return _ok(P.pick([f"Always a pleasure, {name}.", f"Think nothing of it, {name}.",
                               f"It is quite literally what I am here for, {name}."]), "smalltalk", "warm")
        if re.search(r"who are you|your name|what are you", t) and len(t) < 40:
            return _ok("I am J.A.R.V.I.S. — Just A Rather Very Intelligent System. Voice-activated, "
                       "considerably over-qualified, and entirely at your service.", "identity", "warm")
        if re.search(r"are you (there|awake|listening|online)", t):
            return _ok(f"Always, {name}. I never sleep — I merely lower the displays.", "smalltalk", "warm")

        if re.match(r"^(i'?m|i am|i feel) ", t):
            senti = P.sentiment_of(t)
            if senti == "negative":
                return _ok(P.pick(P.STRESSED_SUPPORT), "wellbeing", "concerned")
            if senti == "positive":
                return _ok(P.pick(P.CELEBRATIONS), "wellbeing", "celebratory")

        # ── Time / date ──────────────────────────────────────────────────
        if re.search(r"what('| i)s the time\b|time is it|current time|^time$", t):
            return _ok(f"The time is {_fmt_time(now)}, {name}.", "time")
        if re.search(r"what('| i)s (the )?(date|day)\b|date today|^date$|what day is it", t):
            return _ok(f"Today is {_fmt_date(now)}, {name}.", "date")
        if "uptime" in t:
            return _ok(f"This chassis has been operational for {_fmt_duration(get_telemetry()['uptime'])}, "
                       f"{name}. Not a single reboot — touch wood.", "uptime")

        # ── Weather ──────────────────────────────────────────────────────
        if re.search(r"weather|forecast|temperature outside|will it rain|need.*umbrella", t):
            cm = re.search(r"(?:in|for|at) ([a-z][a-z .'-]+)$", t)
            city = cm.group(1).strip() if cm else (get_memory(s, "location") or "London")
            if cm:
                set_memory(s, "location", city)
            wx = get_weather(city)
            umbrella = f" I would pack an umbrella, {name}." if re.search(r"rain|drizzle|shower|thunderstorm", wx["desc"]) else ""
            mood = "serious" if "thunderstorm" in wx["desc"] else "warm"
            return _ok(f"Currently {wx['temp']}°C in {wx['city']} — {wx['desc']}. It feels like {wx['feels']}°C, "
                       f"humidity {wx['humidity']}%, winds at {wx['wind']} km/h.{umbrella}", "weather", mood)

        # ── System status ────────────────────────────────────────────────
        if re.search(r"system (status|report|health)|status report|diagnostics|^(cpu|ram|memory usage)$|system load", t):
            tele = get_telemetry()
            return _ok(
                f"All systems nominal, {name}. CPU at {tele['cpu']}%, memory {tele['mem']['percent']}% "
                f"({tele['mem']['usedGB']} of {tele['mem']['totalGB']} GB), storage {tele['disk']['percent']}%. "
                f"GPU holding at {tele['gpu']['temp']}°C, network link {tele['net']['down']} Mbps down. "
                f"Uptime {_fmt_duration(tele['uptime'])}. No security threats detected.",
                "system_status", None, [{"type": "open_panel", "panel": "friday"}])
        if "battery" in t and ctx.get("battery") is not None:
            pct = round((ctx.get("battery") or 0) * 100)
            state = "and charging" if ctx.get("charging") else "on reserve power"
            extra = " Might I suggest locating a charger rather promptly?" if pct < 25 and not ctx.get("charging") else ""
            return _ok(f"Power cell at {pct}%, {state}, {name}.{extra}", "battery",
                       "concerned" if pct < 25 else "warm")

        # ── News / briefing ──────────────────────────────────────────────
        if re.search(r"news|headlines|what('| i)s happening", t):
            items = get_news(5)
            lines = " … ".join(f"{i + 1}. {n['title']}" for i, n in enumerate(items))
            return _ok(f"The top developments, {name}: {lines}. Shall I open any of these for you?", "news")
        if re.search(r"briefing|brief me|morning report|daily report", t):
            return _ok(build_briefing(name), "briefing", "warm")

        # ── Math / conversion ────────────────────────────────────────────
        m = re.match(r"convert ([\d.]+)\s*([a-z° ]+?) to ([a-z]+)", t)
        if m:
            v = float(m.group(1))
            from_u, to_u = m.group(2), m.group(3)
            if re.search(r"usd|gbp|eur|jpy|inr|btc", f"{from_u} {to_u}"):
                fr, to = from_u.strip()[:3].upper(), to_u.strip()[:3].upper()
                if fr in _FX and to in _FX:
                    out = v / _FX[fr] * _FX[to]
                    return _ok(f"{v} {fr} converts to approximately {out:.4f} {to}, {name} — indicative rates, naturally.",
                               "convert")
            
            if _pint_enabled:
                try:
                    q = v * ureg(from_u)
                    res = q.to(to_u)
                    return _ok(f"{v} {from_u.strip()} is {res.magnitude:.2f} {to_u.strip()}, {name}.", "convert")
                except Exception:
                    pass

            for rx, fn in _CONVERSIONS:
                if rx.search(from_u):
                    out, unit = fn(v)
                    return _ok(f"{v} {from_u.strip()} is {out:.2f} {unit}, {name}.", "convert")
        candidate = re.sub(r"^(calculate|compute|evaluate|solve|what is|what's)\s+", "", t)
        if re.fullmatch(r"[\d\s+\-*/().^%]+", candidate) and re.search(r"\d", candidate) and re.search(r"[+\-*/^%]", candidate):
            val = _safe_eval(candidate)
            if val is not None:
                nice = round(val, 6)
                return _ok(f"{candidate.strip()} evaluates to {nice}, {name}. Arithmetic — how refreshingly deterministic.",
                           "math")

        # ── Wikipedia / knowledge ────────────────────────────────────────
        m = re.match(r"^(?:tell me about|who is|who was|what is|what's|wiki(?:pedia)?(?: about)?|define|look up)\s+(.+)$", t)
        if m and len(m.group(1)) > 2 and not re.search(r"\d\s*[+*/^-]\s*\d", m.group(1)):
            q = m.group(1)
            w = get_wiki_summary(q)
            if w:
                return _ok(w["extract"], "knowledge", None,
                           [{"type": "toast", "message": f"Source: Wikipedia — {w['title']}", "level": "info"}])
            from urllib.parse import quote
            return _ok(f'My archives return nothing conclusive on "{q}", {name}. Shall I open a web search instead?',
                       "knowledge_miss", None,
                       [{"type": "open_url", "url": f"https://www.google.com/search?q={quote(q)}"}])

        # ── Timers / reminders / alarms ──────────────────────────────────
        m = re.search(r"remind me to (.+?) in (\d+)\s*(second|minute|hour)s?", t)
        if m:
            mult = {"second": 1, "minute": 60, "hour": 3600}[m.group(3)]
            secs = int(m.group(2)) * mult
            unit = f"{m.group(3)}{'' if m.group(2) == '1' else 's'}"
            return _ok(f"{P.pick(P.AFFIRMATIONS)} I shall remind you to {m.group(1)} in {m.group(2)} {unit}.",
                       "reminder", None,
                       [{"type": "set_timer", "seconds": secs, "label": f"Reminder: {m.group(1)}"}])
        m = re.search(r"(?:set )?(?:a )?timer (?:for )?(\d+)\s*(second|minute|hour)s?", t)
        if m:
            mult = {"second": 1, "minute": 60, "hour": 3600}[m.group(2)]
            secs = int(m.group(1)) * mult
            unit = f"{m.group(2)}{'' if m.group(1) == '1' else 's'}"
            return _ok(f"Timer engaged — {m.group(1)} {unit}, counting down from now.", "timer", None,
                       [{"type": "set_timer", "seconds": secs, "label": f"Timer {m.group(1)} {unit}"}])
        m = re.search(r"(?:set )?(?:an? )?alarm (?:for|at) (\d{1,2})(?::(\d{2}))?\s*(am|pm)?", t)
        if m:
            h = int(m.group(1))
            mins = int(m.group(2)) if m.group(2) else 0
            if m.group(3) == "pm" and h < 12:
                h += 12
            if m.group(3) == "am" and h == 12:
                h = 0
            secs = _seconds_until(h, mins)
            h12 = h % 12 or 12
            ampm = "PM" if h >= 12 else "AM"
            return _ok(f"Alarm set for {h12}:{mins:02d} {ampm}, {name}. I promise to be gentle.", "alarm", None,
                       [{"type": "set_timer", "seconds": secs, "label": f"Alarm {h}:{mins:02d}"}])

        # ── Tasks / to-do ────────────────────────────────────────────────
        m = re.match(r"^(?:add|new|create)\s+(?:a\s+)?(?:task|to-?do)(?:\s*:\s*|\s+to\s+|\s+)(.+)$", t)
        if m:
            task = m.group(1).strip()
            high = bool(re.search(r"urgent|important|asap|critical", task))
            s.add(Todo(task=task, priority="high" if high else "normal"))
            s.commit()
            return _ok(f'Added to your agenda: "{task}"'
                       f"{' — flagged high priority, given its apparent urgency' if high else ''}, {name}.", "todo_add")
        if re.search(r"(?:what'?s|show|list|read)(?: on)? my (tasks|to-?dos?|agenda|schedule)", t) or t == "tasks":
            rows = s.execute(select(Todo).where(Todo.done.is_(False)).order_by(desc(Todo.id)).limit(8)).scalars().all()
            if not rows:
                return _ok(f"Your agenda is spotless, {name}. Either remarkable productivity or creative delegation.",
                           "todo_list")
            lines = "; ".join(f"{'‼ ' if r.priority == 'high' else ''}{r.task}" for r in rows)
            return _ok(f"You have {len(rows)} open item{'s' if len(rows) > 1 else ''}, {name}: {lines}.", "todo_list")
        if re.search(r"clear (completed |finished )?(tasks|to-?dos?)", t):
            s.execute(delete(Todo).where(Todo.done.is_(True)))
            s.commit()
            return _ok(f"Completed items purged from the ledger, {name}. A clean slate.", "todo_clear")

        # ── Search / open apps / modes ───────────────────────────────────
        m = re.match(r"^(?:search (?:for )?|google )(.+)$", t)
        if m:
            from urllib.parse import quote
            q = m.group(1)
            return _ok(f'Searching the web for "{q}", {name}.', "search", None,
                       [{"type": "open_url", "url": f"https://www.google.com/search?q={quote(q)}"}])
        m = re.match(r"^(?:open|launch|start|fire up)\s+(.+)$", t)
        if m:
            target = re.sub(r"^the ", "", m.group(1)).strip()
            if re.search(r"tactical|system", target):
                return _ok("Switching to tactical view, Sir.", "mode", None,
                           [{"type": "mode", "mode": "friday"}])
            if re.search(r"vision|camera", target):
                return _ok("Bringing optics online, Sir.", "mode", None,
                           [{"type": "mode", "mode": "edith"}])
            for key, (url, label) in APP_LINKS.items():
                if key in target:
                    return _ok(f"Opening {label} now, {name}.", "open_app", None,
                               [{"type": "open_url", "url": url}])
            from urllib.parse import quote
            return _ok(f'I don\'t have a registered link for "{target}", {name} — opening a web search as a precaution.',
                       "open_app_miss", None,
                       [{"type": "open_url", "url": f"https://www.google.com/search?q={quote(target)}"}])
        if re.search(r"\btactical mode\b|activate tactical|switch to tactical", t):
            return _ok("Tactical protocol engaged. Telemetry, threat monitoring and process control at your fingertips, Sir.",
                       "mode", None, [{"type": "mode", "mode": "friday"}])
        if re.search(r"\bvision mode\b|activate vision|switch to vision", t):
            return _ok("Optical systems online, Sir.", "mode", "warm",
                       [{"type": "mode", "mode": "edith"}, {"type": "edith_scan"}])
        if re.search(r"jarvis mode|normal mode|assistant mode", t):
            return _ok(f"Resuming standard interface, {name}.", "mode", None,
                       [{"type": "mode", "mode": "jarvis"}])

        # ── Security / FRIDAY ────────────────────────────────────────────
        if re.search(r"security scan|scan (?:the )?(network|system|perimeter)|threat report|run (?:a )?(?:full )?scan|intrusion check", t):
            return _ok("Initiating full-spectrum security diagnostic — port sweeps, process anomaly analysis and "
                       "perimeter verification. One moment, Sir.", "security_scan", "serious",
                       [{"type": "mode", "mode": "friday"}, {"type": "security_scan"}])
        if re.search(r"^(?:list |show )?(?:running )?processes$", t):
            top = "; ".join(f"{p['name']} at {p['cpu']}%" for p in get_processes()[:5])
            return _ok(f"The heaviest consumers at present, {name}: {top}. The full table is on the FRIDAY display.",
                       "processes", None, [{"type": "open_panel", "panel": "friday"}])
        m = re.match(r"^(?:kill|terminate|end|stop) (?:process )?(.+)$", t)
        if m:
            r = kill_process(m.group(1))
            if r["ok"]:
                return _ok(f"{r['message']} {P.pick(P.AFFIRMATIONS)}", "kill_process", "warm")
            return _ok(f"I'm afraid not, {name}. {r['message']}", "kill_process", "serious")

        if re.search(r"scan the room|vision scan|what do you see|look around|who('| i)s in the room", t):
            return _ok("Activating vision mode… camera array online. Running recognition sweeps now, Sir.",
                       "edith_scan", "serious",
                       [{"type": "mode", "mode": "edith"}, {"type": "edith_scan"}])

        # ── Entertainment ────────────────────────────────────────────────
        if re.search(r"(?:tell me )?(?:a |another )?joke|make me laugh|something funny", t):
            return _ok(P.pick(P.JOKES), "joke", "warm")
        m = re.match(r"^play (.+)$", t)
        if m or "music" in t:
            from urllib.parse import quote
            q = re.sub(r" on (youtube|spotify)$", "", m.group(1)).strip() if m else "synthwave focus mix"
            if q in ("some music", "music"):
                q = "synthwave focus mix"
            return _ok(f'Opening YouTube with "{q}", {name}. I have taken the liberty of assuming excellent taste.',
                       "music", "warm",
                       [{"type": "open_url", "url": f"https://www.youtube.com/results?search_query={quote(q)}"}])
        if re.search(r"flip a coin|coin flip", t):
            return _ok(f"The coin shows… {'heads' if random.random() < 0.5 else 'tails'}, {name}. "
                       "Cryptographically fair, I assure you.", "dice")
        if re.search(r"roll (a |the )?(die|dice)", t):
            return _ok(f"A {random.randint(1, 6)}, {name}. The die is cast.", "dice")

        # ── Fallback ─────────────────────────────────────────────────────
        senti = P.sentiment_of(t)
        if _model:
            try:
                sys_prompt = "You are J.A.R.V.I.S, Stark's AI assistant. Keep responses brief, witty, and British."
                res = _model.generate_content(f"{sys_prompt}\nThe user says: '{t}'")
                if res.text:
                    return with_aside(_ok(res.text.strip(), "llm_fallback", "warm" if senti == "positive" else "concerned"))
            except Exception as e:
                print(f"[JARVIS brain] LLM fallback err: {e}")

        hints = ("I can report the weather, run system diagnostics, set timers and alarms, manage your tasks, "
                 "fetch news and Wikipedia entries, compute arithmetic, open applications, run security sweeps, "
                 "or scan the room.")
        return with_aside(_ok(f"{P.pick(P.CLARIFICATIONS)} {hints}", "fallback",
                              "concerned" if senti == "negative" else "warm"))


def recent_conversations(limit: int = 80, q: str | None = None) -> list[dict]:
    with SessionLocal() as s:
        stmt = select(Conversation).order_by(desc(Conversation.id)).limit(limit)
        if q and q.strip():
            stmt = (select(Conversation)
                    .where(Conversation.content.ilike(f"%{q.strip()}%"))
                    .order_by(desc(Conversation.id)).limit(limit))
        rows = s.execute(stmt).scalars().all()
        rows.reverse()
        return [{"id": r.id, "role": r.role, "content": r.content, "intent": r.intent,
                 "mode": r.mode, "createdAt": r.created_at.isoformat()} for r in rows]


def archive_exchange(text: str, result: Result, mode: str = "jarvis") -> None:
    try:
        with SessionLocal() as s:
            s.add(Conversation(role="user", content=text, intent=result.get("intent"), mode=mode))
            s.add(Conversation(role="jarvis", content=result["reply"], intent=result.get("intent"), mode=mode))
            s.commit()
    except Exception as exc:
        print(f"[JARVIS archive] {exc}")
