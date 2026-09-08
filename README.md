# J.A.R.V.I.S. — Just A Rather Very Intelligent System

An Iron Man inspired AI command interface: holographic HUD dashboard, voice
interaction with wake-word detection, a witty British personality engine,
FRIDAY tactical monitoring, and E.D.I.T.H. vision.

**Stack: Python (FastAPI) backend · PostgreSQL database · vanilla HTML/CSS/JS frontend.**
A thin Next.js shell hosts the preview (serves the static HUD and proxies
`/api/*` to Python), so the system works identically standalone or hosted.

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│  FRONTEND — public/hud/  (vanilla HTML + CSS + JS)           │
│  • Boot sequence + arc-reactor ignition, WebAudio SFX        │
│  • 3D rotating arc reactor (pure CSS/SVG, pointer tilt)      │
│  • Wake-word mic engine ("Jarvis…") + push-to-talk           │
│  • Deep British TTS (SpeechSynthesis voice selection)        │
│  • GSAP SplitText / BlurText text animations (React Bits     │
│    variants ported to vanilla JS)                            │
│  • Waveform visualiser, gauges, ticker, chat, FRIDAY +       │
│    E.D.I.T.H. canvases                                       │
└──────────────┬───────────────────────────────────────────────┘
               │ REST /api/*
┌──────────────▼───────────────────────────────────────────────┐
│  BACKEND — backend/  (Python · FastAPI · SQLAlchemy)         │
│  • brain.py        NLP intents, entities, mood, actions      │
│  • personality.py  wit, formality, easter eggs               │
│  • telemetry.py    REAL host CPU/mem/disk (via /proc)        │
│  • security.py     FRIDAY scan/threat engine                 │
│  • services.py     Open-Meteo weather, HN news, Wikipedia    │
│  • db.py           SQLAlchemy models + seed                  │
│  • main.py         FastAPI app (also serves the HUD)         │
└──────────────┬───────────────────────────────────────────────┘
               │
┌──────────────▼───────────────────────────────────────────────┐
│  PostgreSQL — conversations · memories · todos ·             │
│               security_events · custom_commands              │
└──────────────────────────────────────────────────────────────┘
```

## Run it

```bash
pip3 install -r backend/requirements.txt
python3 -m uvicorn backend.main:app --host 0.0.0.0 --port 8000
# → open http://localhost:8000
```

Hosted mode (this repo): `npm run build && npm start` — Next spawns uvicorn on
`:8777` via `src/instrumentation.ts` and rewrites `/api/*` to it.

## Phases

| Phase | System | Features |
|-------|--------|----------|
| 1 | **JARVIS core** | Voice commands, wake word, TTS, NLP brain (time/weather/math/wiki/news/timers/todos/open-apps), briefing, HUD, boot sequence |
| 2 | **FRIDAY mode** | Real CPU/RAM/disk telemetry, process table + remote kill, security scans, color-coded threat log |
| 3 | **E.D.I.T.H. mode** | Live camera optics or synthetic viewport, AR target tracking, room scans with biometric log |
| 4 | **Personality & memory** | British wit, sentiment awareness, long-term memory, taught commands ("when I say…"), proactive briefings, cinematic eggs |

## Text animation (React Bits, vanilla port)

The boot wordmark uses the **SplitText** pattern (GSAP `SplitText` plugin,
per-character stagger with `power3.out`), and the tagline + JARVIS greeting
use the **BlurText** pattern (word-by-word blur→focus drift). Both are
implemented in plain JS inside `public/hud/js/jarvis.js`
(`splitTextReveal`, `blurTextIn`) — same props semantics (`delay`,
`duration`, `splitType`, `animateBy`, `direction`, `onComplete`).

## Voice

- **Push-to-talk**: mic button · **Hands-free**: `WAKE` armed → say
  *"Jarvis, what's my system status?"* · follow-ups need no wake word for ~7 s.
- Requires Chrome/Edge for SpeechRecognition; typed directives work everywhere.

## Try saying

“Jarvis, good morning” · “run a full security scan” · “scan the room” ·
“weather in Tokyo” · “tell me about Nikola Tesla” · “set a timer for 5
minutes” · “add task review the Mark VII firmware” · “kill process chrome” ·
“what is 847 * 23 + 19” · “when I say 'movie time', dim the lights and open
netflix” · “I am Iron Man”.

No external API keys required — weather, news and knowledge calls are keyless
with graceful offline fallbacks.
