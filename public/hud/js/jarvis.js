/* ═══════════════════════════════════════════════════════════════════════════
   J.A.R.V.I.S. HUD ENGINE — vanilla JS control layer
   Voice (TTS + wake word), chat pipeline, timers, telemetry, FRIDAY & EDITH
   modules, GSAP SplitText/BlurText text animation twins.
   ═══════════════════════════════════════════════════════════════════════════ */
"use strict";

/* ── tiny helpers ─────────────────────────────────────────────────────────── */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const uid = () => Math.random().toString(36).slice(2, 10);
const pad2 = (n) => String(n).padStart(2, "0");

async function api(path, opts = {}, tries = 3) {
    let lastErr;
    for (let i = 0; i < tries; i++) {
        try {
            const res = await fetch(path, {
                method: opts.method || "GET",
                headers: opts.body ? { "Content-Type": "application/json" } : undefined,
                body: opts.body ? JSON.stringify(opts.body) : undefined,
            });
            return await res.json();
        } catch (e) {
            lastErr = e;
            await sleep(500 * (i + 1)); // backend may still be spinning up
        }
    }
    throw lastErr;
}

/* ══ GSAP text-animation twins (vanilla port of the React Bits components) ══ */
if (window.gsap && window.SplitText) gsap.registerPlugin(SplitText);

/** SplitText — per-character staggered reveal (React Bits: SplitText). */
function splitTextReveal(el, { type = "chars", delay = 50, duration = 0.6, from = { opacity: 0, y: 40 }, onComplete } = {}) {
    if (!el || !el.textContent.trim()) return;
    if (!window.gsap || !window.SplitText) { onComplete && onComplete(); return; }
    try {
        const split = new SplitText(el, { type, charsClass: "split-char", wordsClass: "split-word" });
        const targets = type.includes("chars") && split.chars.length ? split.chars : split.words;
        gsap.fromTo(targets, from, {
            opacity: 1, y: 0, rotateX: 0, duration, ease: "power3.out",
            stagger: delay / 1000, force3D: true,
            onComplete: () => onComplete && onComplete(),
        });
    } catch { onComplete && onComplete(); }
}

/** BlurText — word-by-word blur→focus drift (React Bits: BlurText). */
function blurTextIn(el, { text, delay = 120, stepDuration = 0.35, direction = "top", onComplete } = {}) {
    if (!el) return;
    const content = text ?? el.textContent;
    const words = content.split(" ");
    el.innerHTML = "";
    const spans = words.map((w, i) => {
        const s = document.createElement("span");
        s.className = "blur-word";
        s.textContent = w;
        el.appendChild(s);
        if (i < words.length - 1) el.appendChild(document.createTextNode(" "));
        return s;
    });
    if (!window.gsap) { onComplete && onComplete(); return; }
    const y = direction === "top" ? -26 : 26;
    gsap.set(spans, { opacity: 0, filter: "blur(10px)", y });
    gsap.to(spans, {
        keyframes: [
            { opacity: 0.5, filter: "blur(4px)", y: direction === "top" ? 4 : -4, duration: stepDuration },
            { opacity: 1, filter: "blur(0px)", y: 0, duration: stepDuration },
        ],
        stagger: delay / 1000, ease: "power1.out",
        onComplete: () => onComplete && onComplete(),
    });
}

/* ══ Sound FX (WebAudio synthesis — no audio assets) ════════════════════════ */
class SynthFx {
    constructor() { this.ctx = null; this.enabled = true; }
    ensure() {
        if (!this.ctx) {
            const AC = window.AudioContext || window.webkitAudioContext;
            if (AC) this.ctx = new AC();
        }
        if (this.ctx && this.ctx.state === "suspended") this.ctx.resume();
        return this.ctx;
    }
    tone({ f, f2, t = 0, d = 0.18, type = "sine", g = 0.1 }) {
        const ctx = this.ensure();
        if (!ctx || !this.enabled) return;
        const osc = ctx.createOscillator(), gain = ctx.createGain();
        const t0 = ctx.currentTime + t;
        osc.type = type;
        osc.frequency.setValueAtTime(f, t0);
        if (f2) osc.frequency.exponentialRampToValueAtTime(f2, t0 + d);
        gain.gain.setValueAtTime(0.0001, t0);
        gain.gain.exponentialRampToValueAtTime(g, t0 + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + d);
        osc.connect(gain).connect(ctx.destination);
        osc.start(t0); osc.stop(t0 + d + 0.05);
    }
    click() { this.tone({ f: 1350, d: 0.05, type: "square", g: 0.03 }); }
    wake() { this.tone({ f: 520, f2: 940, d: 0.16, g: 0.09 }); this.tone({ f: 1175, d: 0.09, t: 0.14, g: 0.07 }); }
    notify() { this.tone({ f: 880, d: 0.1, g: 0.08 }); this.tone({ f: 1320, d: 0.14, t: 0.11, g: 0.08 }); }
    alert() { for (let i = 0; i < 3; i++) { this.tone({ f: 392, d: 0.16, t: i * 0.22, type: "square", g: 0.06 }); this.tone({ f: 311, d: 0.16, t: i * 0.22 + 0.1, type: "square", g: 0.05 }); } }
    timerDone() { [1047, 1319, 1568, 2093].forEach((f, i) => this.tone({ f, d: 0.35, t: i * 0.18, g: 0.09 })); }
    online() { [196, 246.9, 293.7, 392].forEach((f) => this.tone({ f, d: 1.1, g: 0.05 })); this.tone({ f: 784, d: 1.3, t: 0.1, g: 0.03 }); }
    startup() {
        [130.8, 164.8, 196, 261.6, 329.6, 392, 523.3, 659.3].forEach((f, i) => this.tone({ f, d: 0.22, t: i * 0.09, g: 0.07, type: "triangle" }));
        this.tone({ f: 90, f2: 480, t: 0.4, d: 1.7, type: "sawtooth", g: 0.02 });
        this.tone({ f: 1046.5, d: 0.9, t: 0.85, g: 0.05 });
    }
}

/* ══ Voice out (TTS — deep, British, calm) ══════════════════════════════════ */
const PREFERRED_VOICES = ["Google UK English Male", "Daniel", "Ryan", "George", "Arthur", "Brian", "Oliver", "James", "Alfie", "Google UK English"];

function cleanForSpeech(text) {
    return text
        .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}]/gu, "")
        .replace(/[‼•·►▸]/g, "")
        .replace(/\*\*(.+?)\*\*/g, "$1")
        .replace(/J\.A\.R\.V\.I\.S\./g, "Jarvis")
        .replace(/E\.D\.I\.T\.H\./g, "Edith")
        .replace(/F\.R\.I\.D\.A\.Y\./g, "Friday")
        .replace(/(\d+)°C/g, "$1 degrees Celsius")
        .replace(/(\d+)°F/g, "$1 degrees Fahrenheit")
        .replace(/…/g, ". ")
        .replace(/\s+/g, " ")
        .trim();
}

class VoiceEngine {
    constructor() {
        this.voices = [];
        this.speaking = false;
        this.supported = "speechSynthesis" in window;
        if (this.supported) {
            const load = () => { this.voices = speechSynthesis.getVoices(); };
            load();
            speechSynthesis.onvoiceschanged = load;
        }
    }
    pickVoice() {
        const vs = this.voices.length ? this.voices : (this.supported ? speechSynthesis.getVoices() : []);
        if (!vs.length) return null;
        for (const n of PREFERRED_VOICES) {
            const v = vs.find((x) => x.name === n || x.name.includes(n));
            if (v) return v;
        }
        const gb = vs.filter((v) => v.lang.replace("_", "-") === "en-GB");
        const male = gb.find((v) => /male/i.test(v.name) && !/female/i.test(v.name));
        return male || gb[0] || vs.find((v) => v.lang.startsWith("en")) || vs[0];
    }
    stop() { if (this.supported) speechSynthesis.cancel(); this.speaking = false; }
    speak(text, onStart, onEnd) {
        if (!this.supported) { onStart && onStart(); onEnd && onEnd(); return; }
        const cleaned = cleanForSpeech(text);
        speechSynthesis.cancel();
        const chunks = cleaned.match(/[^.!?]+[.!?:;]*/g) || [cleaned];
        const voice = this.pickVoice();
        const isGB = !!voice && voice.lang.replace("_", "-") === "en-GB";
        let i = 0, started = false;
        this.speaking = true;
        const next = () => {
            if (i >= chunks.length) { this.speaking = false; onEnd && onEnd(); return; }
            const u = new SpeechSynthesisUtterance(chunks[i].trim());
            if (voice) u.voice = voice;
            u.lang = voice ? voice.lang : "en-GB";
            u.pitch = isGB ? 0.75 : 0.6;   // deep
            u.rate = 0.98;                  // unhurried
            u.volume = 1;
            u.onstart = () => { if (!started) { started = true; onStart && onStart(); } };
            u.onend = () => { i++; next(); };
            u.onerror = () => { i++; next(); };
            speechSynthesis.speak(u);
        };
        next();
    }
}

/* ══ Voice in (wake word + push-to-talk) ════════════════════════════════════ */
const WAKE_WORDS = ["jarvis", "javis", "jarvus", "jervis"];
const FOLLOW_UP_MS = 7000;

class MicEngine {
    constructor(cb) {
        this.cb = cb;
        const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
        this.supported = !!SR;
        this.wakeOn = false;
        this.pttArmed = false;
        this.shouldRun = false;
        this.lastWake = 0;
        this.running = false;
        if (!SR) return;
        this.rec = new SR();
        this.rec.lang = "en-US";
        this.rec.interimResults = true;
        this.rec.continuous = true;
        this.rec.maxAlternatives = 1;
        this.rec.onresult = (e) => this.handleResult(e);
        this.rec.onend = () => {
            this.running = false;
            if (this.shouldRun) setTimeout(() => this.safeStart(), 280);
            else this.cb.onActivity && this.cb.onActivity(false);
        };
        this.rec.onerror = (e) => {
            if (e.error === "not-allowed" || e.error === "service-not-allowed") {
                this.shouldRun = false; this.wakeOn = false;
                this.cb.onError && this.cb.onError("Microphone access was denied — voice control requires mic permission.");
            }
        };
    }
    safeStart() {
        if (this.running || !this.rec) return;
        try { this.rec.start(); this.running = true; this.cb.onActivity && this.cb.onActivity(true); } catch { /* started */ }
    }
    handleResult(e) {
        for (let i = e.resultIndex; i < e.results.length; i++) {
            const res = e.results[i];
            const text = res[0].transcript.trim();
            if (!res.isFinal) { this.cb.onInterim && this.cb.onInterim(text); continue; }
            const lower = text.toLowerCase();
            if (!lower) continue;
            if (this.pttArmed) {
                this.pttArmed = false;
                this.cb.onInterim && this.cb.onInterim("");
                this.cb.onCommand(text.replace(/^(?:hey\s+)?jarvis[, ]*/i, "").trim() || text);
                continue;
            }
            if (!this.wakeOn) continue;
            let wakeIdx = -1;
            for (const wd of WAKE_WORDS) { const at = lower.lastIndexOf(wd); if (at > wakeIdx) wakeIdx = at; }
            if (wakeIdx >= 0) {
                this.lastWake = Date.now();
                const rest = text.slice(wakeIdx).replace(/^.*?(jarvis|javis|jarvus|jervis)[, ]*/i, "").trim();
                if (rest) this.cb.onCommand(rest);
                else this.cb.onWake();
            } else if (Date.now() - this.lastWake < FOLLOW_UP_MS) {
                this.lastWake = 0;
                this.cb.onCommand(text);
            }
        }
    }
    setWakeEnabled(on) {
        this.wakeOn = on;
        if (on) { this.shouldRun = true; this.safeStart(); }
        else if (!this.pttArmed) { this.shouldRun = false; try { this.rec && this.rec.stop(); } catch { } }
    }
    startPtt() { if (!this.supported) return; this.pttArmed = true; this.shouldRun = true; this.safeStart(); }
    dispose() { this.shouldRun = false; try { this.rec && this.rec.abort(); } catch { } }
}

/* ══ Global state ═══════════════════════════════════════════════════════════ */
const STATE = {
    status: "boot",           // boot | online | listening | processing | speaking
    mode: "jarvis",
    voiceOn: true,
    wakeOn: false,
    tele: null,
    battery: null,
    charging: null,
    timers: [],
    busy: false,
    queue: [],
    scanning: false,
};
const fx = new SynthFx();
const voice = new VoiceEngine();
let mic = null;

const STATUS_LABEL = { boot: "BOOTING", online: "ONLINE", listening: "LISTENING", processing: "PROCESSING", speaking: "SPEAKING" };

function setStatus(s) {
    STATE.status = s;
    $("#statusText").textContent = STATUS_LABEL[s];
    $("#statusPill").className = `status-pill st-${s}`;
    $("#reactorStatus").className = `reactor-status st-${s}`;
    $("#reactorStatusText").textContent = STATUS_LABEL[s];
    $$(".reactor").forEach((r) => r.setAttribute("class", `reactor st-${s}`));
}

/* ══ Arc reactor construction ═══════════════════════════════════════════════ */
function reactorHTML() {
    const chevrons = Array.from({ length: 10 }, (_, i) => `<span class="r-chev" style="transform:rotate(${i * 36}deg)"></span>`).join("");
    const coils = Array.from({ length: 8 }, (_, i) => `<span class="r-coil" style="transform:rotate(${i * 45}deg)"></span>`).join("");
    const dots = Array.from({ length: 6 }, (_, i) => `<span class="r-dot" style="animation-delay:${i * -0.9}s;animation-duration:${4.5 + i * 0.7}s"></span>`).join("");
    return `
    <div class="reactor-tilt">
      <div class="r-bleed"></div>
      <svg class="r-svg r-spin-slow" viewBox="0 0 100 100">
        <defs><linearGradient id="rg-${uid()}" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#59e6ff"/><stop offset="100%" stop-color="#00a8cc"/>
        </linearGradient></defs>
        <circle cx="50" cy="50" r="48" fill="none" stroke="rgba(86,196,255,.14)" stroke-width="0.7"/>
        <circle cx="50" cy="50" r="48" fill="none" stroke="#38d6ff" stroke-width="0.9" stroke-dasharray="4 2.4 1 2.4" stroke-linecap="round" opacity=".85"/>
      </svg>
      <svg class="r-svg r-spin-rev" viewBox="0 0 100 100">
        <circle cx="50" cy="50" r="43.5" fill="none" stroke="rgba(88,214,255,.5)" stroke-width="2.4" stroke-dasharray="0.6 3.14"/>
        <circle cx="50" cy="50" r="43.5" fill="none" stroke="rgba(120,240,255,.9)" stroke-width="2.4" stroke-dasharray="6 262" stroke-linecap="round" class="r-hotseg"/>
      </svg>
      <div class="r-cage r-spin-mid">${chevrons}</div>
      <div class="r-coils r-spin-rev-slow">${coils}</div>
      <svg class="r-svg r-svg-inner r-spin-fast" viewBox="0 0 100 100">
        <circle cx="50" cy="50" r="34.5" fill="none" stroke="rgba(0,225,255,.65)" stroke-width="1.1" stroke-dasharray="14 5 2.5 5" stroke-linecap="round"/>
      </svg>
      <div class="r-core">
        <svg class="r-tri" viewBox="0 0 100 100">
          <polygon points="50,20 76,66 24,66" fill="none" stroke="rgba(190,250,255,.9)" stroke-width="3" stroke-linejoin="round"/>
          <polygon points="50,30 68,62 32,62" fill="rgba(140,240,255,.14)" stroke="rgba(140,240,255,.4)" stroke-width="1"/>
        </svg>
        <div class="r-plasma"></div><div class="r-orb"></div>
      </div>
      <div class="r-particles">${dots}</div>
    </div>`;
}

function mountReactors() {
    $$(".reactor-host").forEach((host) => {
        const size = parseInt(host.dataset.size || "200", 10);
        const status = host.dataset.status || STATE.status;
        const reactor = document.createElement("div");
        reactor.className = `reactor st-${status === "boot" ? "boot" : "online"}`;
        reactor.style.width = size + "px";
        reactor.style.height = size + "px";
        reactor.style.fontSize = size + "px";
        reactor.innerHTML = reactorHTML();
        host.appendChild(reactor);
        // pseudo-3D pointer tilt
        reactor.addEventListener("pointermove", (e) => {
            const r = reactor.getBoundingClientRect();
            const x = (e.clientX - r.left) / r.width - 0.5;
            const y = (e.clientY - r.top) / r.height - 0.5;
            reactor.style.setProperty("--ry", (x * 14).toFixed(2) + "deg");
            reactor.style.setProperty("--rx", (-y * 14).toFixed(2) + "deg");
        });
        reactor.addEventListener("pointerleave", () => {
            reactor.style.setProperty("--rx", "0deg");
            reactor.style.setProperty("--ry", "0deg");
        });
    });
}

/* ══ Waveform visualiser ════════════════════════════════════════════════════ */
function startWaveform() {
    const canvas = $("#waveCanvas");
    const ctx = canvas.getContext("2d");
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const BARS = 72;
    const resize = () => {
        const r = canvas.getBoundingClientRect();
        if (r.width) { canvas.width = r.width * dpr; canvas.height = r.height * dpr; }
    };
    resize();
    window.addEventListener("resize", resize);
    const draw = (tms) => {
        requestAnimationFrame(draw);
        if (!canvas.width) resize();
        const t = tms / 1000, W = canvas.width, H = canvas.height;
        ctx.clearRect(0, 0, W, H);
        const st = STATE.status;
        const gain = st === "speaking" ? 1 : st === "listening" ? 0.6 : st === "processing" ? 0.42 : 0.14;
        const speed = st === "processing" ? 7.5 : st === "speaking" ? 5.2 : 1.8;
        const bw = W / BARS, mid = H / 2;
        for (let i = 0; i < BARS; i++) {
            const n = i / BARS, env = Math.sin(n * Math.PI);
            let a = 0.35 + 0.65 * Math.abs(Math.sin(i * 0.9 + t * speed) * Math.sin(i * 0.31 - t * speed * 0.6) + (st === "speaking" ? Math.sin(i * 2.3 + t * 13) * 0.55 : 0));
            a *= env * gain;
            const h = Math.max(1.5 * dpr, a * H * 0.44);
            const x = i * bw + bw * 0.22, wdt = bw * 0.56;
            const grad = ctx.createLinearGradient(0, mid - h, 0, mid + h);
            grad.addColorStop(0, "rgba(120,240,255,.95)");
            grad.addColorStop(0.5, "rgba(0,190,255,.75)");
            grad.addColorStop(1, "rgba(120,240,255,.95)");
            ctx.fillStyle = grad;
            ctx.shadowColor = "rgba(0,210,255,.8)";
            ctx.shadowBlur = 8 * dpr * gain;
            const rr = Math.min(wdt / 2, 2 * dpr);
            ctx.beginPath();
            if (ctx.roundRect) ctx.roundRect(x, mid - h, wdt, h * 2, rr); else ctx.rect(x, mid - h, wdt, h * 2);
            ctx.fill();
        }
        ctx.shadowBlur = 0;
        ctx.fillStyle = "rgba(70,200,255,.25)";
        ctx.fillRect(0, mid - 0.5 * dpr, W, 1 * dpr);
    };
    requestAnimationFrame(draw);
}

/* ══ Gauges & sparklines ════════════════════════════════════════════════════ */
const TONES = { cyan: "#5fe3ff", amber: "#ffc46b", red: "#ff5d6c", green: "#54f0b0" };
const toneFor = (p) => (p >= 90 ? "red" : p >= 72 ? "amber" : "cyan");

function makeGauge(host, { label, size = 84 }) {
    const R = 44, CIRC = 2 * Math.PI * R;
    host.insertAdjacentHTML("beforeend", `
    <div class="gauge" style="width:${size}px">
      <svg viewBox="0 0 100 100" width="${size}" height="${size}">
        <circle cx="50" cy="50" r="${R}" fill="none" stroke="rgba(90,200,255,.10)" stroke-width="6"/>
        <circle cx="50" cy="50" r="${R - 5.5}" fill="none" stroke="rgba(90,200,255,.13)" stroke-width="1" stroke-dasharray="1 3.02"/>
        <circle class="g-arc" cx="50" cy="50" r="${R}" fill="none" stroke="${TONES.cyan}" stroke-width="4.4"
          stroke-linecap="round" stroke-dasharray="${CIRC}" stroke-dashoffset="${CIRC}"
          transform="rotate(-90 50 50)" style="filter:drop-shadow(0 0 5px ${TONES.cyan});transition:stroke-dashoffset .7s cubic-bezier(.22,1,.36,1),stroke .4s"/>
        <text class="g-num gauge-num" x="50" y="49" text-anchor="middle">0</text>
        <text class="g-unit gauge-unit" x="50" y="60" text-anchor="middle">%</text>
      </svg>
      <span class="gauge-label">${label}</span>
    </div>`);
    const rootEl = host.lastElementChild;
    const arc = $(".g-arc", rootEl), num = $(".g-num", rootEl), unit = $(".g-unit", rootEl);
    return {
        set(value, { display, sub, tone } = {}) {
            const v = Math.max(0, Math.min(100, value));
            const c = TONES[tone || TONES.cyan] || TONES.cyan;
            arc.setAttribute("stroke-dashoffset", String(CIRC * (1 - v / 100)));
            arc.setAttribute("stroke", c);
            arc.style.filter = `drop-shadow(0 0 5px ${c})`;
            num.textContent = display ?? String(Math.round(v));
            unit.textContent = sub ?? "%";
        },
    };
}

function makeSpark(host, tone = "cyan") {
    const W = parseInt(host.dataset.w || "210", 10), H = parseInt(host.dataset.h || "40", 10);
    const data = new Array(24).fill(2);
    host.insertAdjacentHTML("beforeend", `<svg class="spark" viewBox="0 0 ${W} ${H}" width="100%" height="${H}" preserveAspectRatio="none"><path class="s-area" fill="${TONES[tone]}22"/><path class="s-line" fill="none" stroke="${TONES[tone]}" stroke-width="1.6" style="filter:drop-shadow(0 0 4px ${TONES[tone]})"/></svg>`);
    const svg = host.lastElementChild, line = $(".s-line", svg), area = $(".s-area", svg);
    return {
        push(v) {
            data.push(v);
            if (data.length > 24) data.shift();
            const max = Math.max(...data, 1);
            const linePath = data.map((d, i) => `${i ? "L" : "M"}${((i / (data.length - 1)) * W).toFixed(1)},${(H - 3 - (d / max) * (H - 8)).toFixed(1)}`).join(" ");
            line.setAttribute("d", linePath);
            area.setAttribute("d", `${linePath} L${W},${H} L0,${H} Z`);
        },
    };
}

/* ══ Toasts ═════════════════════════════════════════════════════════════════ */
function toast(message, level = "info") {
    const host = $("#toasts");
    const t = document.createElement("div");
    t.className = `toast tv-${level}`;
    const bar = document.createElement("span");
    bar.className = "toast-bar";
    t.appendChild(bar);
    t.appendChild(document.createTextNode(message));
    host.appendChild(t);
    while (host.children.length > 5) host.firstChild.remove();
    if (level === "critical") fx.alert();
    else if (level === "warning") fx.notify();
    setTimeout(() => t.remove(), 5600);
}

/* ══ Chat ═══════════════════════════════════════════════════════════════════ */
function nowHM() { const d = new Date(); return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`; }

function addMsg(role, text, { fxKind } = {}) {
    const chat = $("#chat");
    const row = document.createElement("div");
    row.className = `msg ${role}`;
    const tag = document.createElement("span");
    tag.className = "msg-tag";
    tag.textContent = role === "jarvis" ? "JARVIS" : "YOU";
    const bubble = document.createElement("div");
    bubble.className = "msg-bubble";
    const time = document.createElement("span");
    time.className = "msg-time";
    time.textContent = nowHM();
    row.append(tag, bubble, time);
    chat.appendChild(row);
    while (chat.children.length > 80) chat.firstChild.remove();
    chat.scrollTop = chat.scrollHeight;

    if (role === "jarvis" && fxKind === "blur") {
        blurTextIn(bubble, { text, delay: 28, stepDuration: 0.22 });
    } else if (role === "jarvis") {
        typewriter(bubble, text);
    } else {
        bubble.textContent = text;
    }
    chat.scrollTop = chat.scrollHeight;
    return bubble;
}

function typewriter(node, text) {
    let n = 0;
    const caret = document.createElement("span");
    caret.className = "caret";
    caret.textContent = "▌";
    node.textContent = "";
    node.appendChild(caret);
    const iv = setInterval(() => {
        n = Math.min(text.length, n + 2);
        node.textContent = text.slice(0, n);
        if (n < text.length) node.appendChild(caret);
        else clearInterval(iv);
        const chat = $("#chat");
        chat.scrollTop = chat.scrollHeight;
    }, 18);
}

let interimEl = null;
function showInterim(text) {
    if (!text) { if (interimEl) { interimEl.remove(); interimEl = null; } return; }
    if (!interimEl) {
        interimEl = document.createElement("div");
        interimEl.className = "interim";
        $("#chat").appendChild(interimEl);
    }
    interimEl.textContent = `“${text}…”`;
    $("#chat").scrollTop = $("#chat").scrollHeight;
}

/* ══ Speech output ══════════════════════════════════════════════════════════ */
function speak(text) {
    if (!STATE.voiceOn || !voice.supported) { STATE.busy = false; pump(); return; }
    setStatus("speaking");
    voice.speak(
        text,
        () => setStatus("speaking"),
        () => {
            setStatus(STATE.wakeOn ? "listening" : "online");
            STATE.busy = false;
            pump();
        }
    );
}

/* ══ Actions from the brain ═════════════════════════════════════════════════ */
function applyActions(actions) {
    if (!actions) return;
    for (const a of actions) {
        switch (a.type) {
            case "open_url": if (a.url) window.open(a.url, "_blank", "noopener"); break;
            case "open_panel": if (a.panel) setMode(a.panel); break;
            case "mode": if (a.mode) setMode(a.mode); break;
            case "set_timer": {
                STATE.timers.push({ id: uid(), label: a.label || "Timer", endsAt: Date.now() + (a.seconds || 60) * 1000 });
                renderTimers();
                break;
            }
            case "security_scan": void runScan(); break;
            case "edith_scan": triggerEdithScan(); break;
            case "toast": if (a.message) toast(a.message, a.level || "info"); break;
        }
    }
}

/* ══ Command pipeline ═══════════════════════════════════════════════════════ */
async function send(raw) {
    const text = (raw || "").trim();
    if (!text) return;
    if (STATE.busy) {
        if (STATE.queue.length < 5) { STATE.queue.push(text); toast(`Directive queued: “${text.slice(0, 40)}”`, "info"); }
        return;
    }
    STATE.busy = true;
    addMsg("user", text);
    $("#cmdInput").value = "";
    showInterim("");
    setStatus("processing");
    fx.click();
    try {
        const data = await api("/api/command", {
            method: "POST",
            body: { text, context: { battery: STATE.battery, charging: STATE.charging, mode: STATE.mode } },
        });
        addMsg("jarvis", data.reply || "…", {});
        applyActions(data.actions);
        if (["todo_add", "todo_clear"].includes(data.intent)) void loadTodos();
        speak(data.reply || "");
        if (!STATE.voiceOn || !voice.supported) {
            STATE.busy = false;
            if (STATE.status !== "speaking") setStatus(STATE.wakeOn ? "listening" : "online");
            pump();
        }
    } catch {
        addMsg("jarvis", "Communications fault, Sir — the uplink stuttered. Do try again.");
        STATE.busy = false;
        setStatus("online");
        pump();
    }
}

function pump() {
    if (STATE.busy) return;
    const next = STATE.queue.shift();
    if (next) void send(next);
}

/* ══ FRIDAY: security scan ══════════════════════════════════════════════════ */
async function runScan() {
    if (STATE.scanning) return;
    STATE.scanning = true;
    const btn = $("#scanBtn");
    btn.disabled = true;
    btn.textContent = "SWEEPING…";
    $("#sweepbar").classList.remove("dnone");
    try {
        const data = await api("/api/security", { method: "POST", body: { action: "scan" } });
        await loadAlerts();
        if (data.threatLevel === "critical") fx.alert();
        addMsg("jarvis", data.summary || "Scan complete.");
        speak(data.summary || "Scan complete.");
        if (data.threatLevel && data.threatLevel !== "info") toast(`FRIDAY scan: threat level ${String(data.threatLevel).toUpperCase()}`, data.threatLevel);
    } catch {
        toast("FRIDAY diagnostic uplink failed", "warning");
    } finally {
        STATE.scanning = false;
        btn.disabled = false;
        btn.textContent = "RUN FULL DIAGNOSTIC";
        $("#sweepbar").classList.add("dnone");
    }
}

/* ══ Mode switching ═════════════════════════════════════════════════════════ */
let fridayRevealed = false;
function setMode(mode) {
    STATE.mode = mode;
    $("#hud").dataset.mode = mode;
    fx.click();
    $$(".mode-tab").forEach((b) => b.classList.toggle("active", b.dataset.mode === mode));
    $("#jarvisStage").classList.toggle("dnone", mode !== "jarvis");
    $("#fridayStage").classList.toggle("dnone", mode !== "friday");
    $("#edithStage").classList.toggle("dnone", mode !== "edith");
    if (mode === "friday" && !fridayRevealed) {
        fridayRevealed = true;
        splitTextReveal($("#fridayTitle"), { delay: 30, from: { opacity: 0, y: 26 }, duration: 0.5 });
    }
}

/* ══ Data loading + rendering ═══════════════════════════════════════════════ */
const gauges = {};
let sparks = {};

function fmtUptime(sec) {
    const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60);
    return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`;
}
function fmtUptimeLong(sec) {
    const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60);
    if (d) return `${d}D ${h}H ${m}M`;
    if (h) return `${h}H ${m}M`;
    return `${m}M ${Math.floor(sec % 60)}S`;
}

async function pollTelemetry() {
    try {
        const t = await api("/api/telemetry", {}, 1);
        STATE.tele = t;
        gauges.cpu.set(t.cpu, { tone: toneFor(t.cpu) });
        gauges.mem.set(t.mem.percent, { tone: toneFor(t.mem.percent) });
        gauges.disk.set(t.disk.percent, { tone: toneFor(t.disk.percent) });
        sparks.cpu.push(t.cpu);
        $("#vGpu").textContent = `${t.gpu.temp}°C`;
        $("#vUp").textContent = `${t.net.up} Mb/s ↑ · ${t.net.down} Mb/s ↓`;
        $("#vBat").textContent = STATE.battery == null ? "EXTERNAL PSU" : `${Math.round(STATE.battery * 100)}% ${STATE.charging ? "⚡" : ""}`;
        $("#vUptime").textContent = fmtUptime(t.uptime);
        // FRIDAY
        gauges.fCpu.set(t.cpu, { tone: toneFor(t.cpu) });
        gauges.fMem.set(t.mem.percent, { display: `${t.mem.usedGB}`, sub: `/${t.mem.totalGB}G`, tone: toneFor(t.mem.percent) });
        gauges.fDisk.set(t.disk.percent, { display: `${Math.round(t.disk.percent)}`, sub: `${t.disk.usedGB}G`, tone: toneFor(t.disk.percent) });
        gauges.fGpu.set(t.gpu.temp, { display: `${t.gpu.temp}°`, sub: "°C", tone: toneFor(t.gpu.temp * 1.1) });
        gauges.fNet.set(Math.min(100, t.net.down / 2), { display: `${t.net.down}`, sub: "Mbps", tone: "green" });
        sparks.fCpu.push(t.cpu);
        sparks.fNet.push(t.net.down);
        $("#fridaySub").textContent = `${t.host} · ${t.platform} · ${t.cores} CORES · UPTIME ${fmtUptimeLong(t.uptime)}`;
        renderProcs(t.processes || []);
    } catch { /* backend warming up */ }
}

function renderProcs(procs) {
    const body = $("#procBody");
    body.innerHTML = "";
    procs.slice(0, 9).forEach((p) => {
        const tr = document.createElement("tr");
        tr.innerHTML = `<td class="mono-dim">${p.pid}</td><td></td><td class="${p.cpu > 25 ? "hot" : ""}">${p.cpu.toFixed(1)}</td><td class="mono-dim">${p.mem}</td><td></td>`;
        tr.children[1].textContent = p.name;
        const btn = document.createElement("button");
        btn.className = "killbtn";
        btn.title = "Terminate process";
        btn.textContent = "✕";
        btn.onclick = () => killProc(p.pid);
        tr.children[4].appendChild(btn);
        body.appendChild(tr);
    });
}

async function killProc(pid) {
    try {
        const d = await api("/api/security", { method: "POST", body: { action: "kill", pid } });
        const el = $("#killMsg");
        el.textContent = d.message || "";
        setTimeout(() => { el.textContent = ""; }, 4000);
    } catch { /* noop */ }
}

async function loadAlerts() {
    try {
        const d = await api("/api/alerts", {}, 1);
        const items = d.items || [];
        const list = $("#alertList");
        list.innerHTML = "";
        if (!items.length) {
            list.innerHTML = '<div class="alert-empty">No events on record. Perimeter quiet.</div>';
        }
        items.forEach((a) => {
            const row = document.createElement("div");
            row.className = `alert-row lv-${a.level}${a.acknowledged ? " acked" : ""}`;
            const dot = document.createElement("span");
            dot.className = "alert-dot";
            const body = document.createElement("div");
            body.className = "alert-body";
            const msg = document.createElement("span");
            msg.className = "alert-msg";
            msg.textContent = a.message;
            const meta = document.createElement("span");
            meta.className = "alert-meta";
            const ts = new Date(a.createdAt);
            meta.textContent = `${a.source} · ${pad2(ts.getHours())}:${pad2(ts.getMinutes())}:${pad2(ts.getSeconds())} · ${a.level.toUpperCase()}${a.acknowledged ? " · ACK" : ""}`;
            body.append(msg, meta);
            row.append(dot, body);
            if (!a.acknowledged) {
                const ack = document.createElement("button");
                ack.className = "linkbtn";
                ack.textContent = "ACK";
                ack.onclick = () => ackAlert(a.id);
                row.appendChild(ack);
            }
            list.appendChild(row);
        });
        const crit = items.some((a) => a.level === "critical" && !a.acknowledged);
        const warn = items.some((a) => a.level === "warning" && !a.acknowledged);
        const badge = $("#threatBadge");
        badge.className = `threat-badge th-${crit ? "critical" : warn ? "elevated" : "secure"}`;
        badge.textContent = crit ? "CRITICAL THREAT" : warn ? "ELEVATED ACTIVITY" : "PERIMETER SECURE";
    } catch { /* noop */ }
}

async function ackAlert(id, all) {
    try {
        await api("/api/alerts", { method: "PATCH", body: { id, all } });
        void loadAlerts();
    } catch { /* noop */ }
}

async function loadWeather() {
    try {
        const w = await api("/api/weather", {}, 1);
        $("#wxCity").textContent = (w.city || "").toUpperCase();
        $("#wxBody").innerHTML = `
      <div class="wx">
        <div class="wx-main">
          <span class="wx-temp">${w.temp}°</span>
          <div class="wx-desc"><b>${(w.desc || "").toUpperCase()}</b><span>FEELS ${w.feels}°C</span></div>
        </div>
        <div class="wx-grid">
          <div class="vital"><span>WIND</span><b>${w.wind} km/h</b></div>
          <div class="vital"><span>HUMIDITY</span><b>${w.humidity}%</b></div>
        </div>
      </div>`;
    } catch { /* noop */ }
}

async function loadNews() {
    try {
        const d = await api("/api/news", {}, 1);
        const items = (d.items || []).concat(d.items || []);
        const track = $("#newsTrack");
        track.innerHTML = "";
        items.forEach((n) => {
            const a = document.createElement("a");
            a.className = "news-item";
            a.href = n.url;
            a.target = "_blank";
            a.rel = "noreferrer";
            const dot = document.createElement("span");
            dot.className = "news-dot";
            a.appendChild(dot);
            a.appendChild(document.createTextNode(n.title));
            track.appendChild(a);
        });
    } catch { /* noop */ }
}

async function loadTodos() {
    try {
        const d = await api("/api/todos", {}, 1);
        const items = d.items || [];
        $("#taskCount").textContent = String(items.filter((t) => !t.done).length);
        const list = $("#taskList");
        list.innerHTML = "";
        items.slice(0, 6).forEach((t) => {
            const row = document.createElement("div");
            row.className = `task-row${t.done ? " done" : ""}`;
            const check = document.createElement("button");
            check.className = "task-check";
            check.textContent = t.done ? "✓" : "";
            check.onclick = () => toggleTodo(t);
            const span = document.createElement("span");
            span.className = "task-text";
            if (t.priority === "high") {
                const flag = document.createElement("em");
                flag.className = "task-flag";
                flag.textContent = "HIGH";
                span.appendChild(flag);
            }
            span.appendChild(document.createTextNode(t.task));
            const del = document.createElement("button");
            del.className = "killbtn";
            del.textContent = "✕";
            del.onclick = () => deleteTodo(t.id);
            row.append(check, span, del);
            list.appendChild(row);
        });
    } catch { /* noop */ }
}

async function toggleTodo(t) { await api("/api/todos", { method: "PATCH", body: { id: t.id, done: !t.done } }); void loadTodos(); }
async function deleteTodo(id) { await api("/api/todos", { method: "PATCH", body: { id, remove: true } }); void loadTodos(); }
async function addTodo(task) { await api("/api/todos", { method: "POST", body: { task } }); void loadTodos(); }

/* ══ Timers ═════════════════════════════════════════════════════════════════ */
function renderTimers() {
    const panel = $("#timersPanel"), list = $("#timersList");
    panel.classList.toggle("dnone", STATE.timers.length === 0);
    list.innerHTML = "";
    STATE.timers.forEach((t) => {
        const chip = document.createElement("div");
        chip.className = "timer-chip";
        chip.innerHTML = `<span class="timer-pip"></span><div class="timer-info"><span class="timer-label"></span><span class="timer-left" data-end="${t.endsAt}"></span></div>`;
        $(".timer-label", chip).textContent = t.label;
        const btn = document.createElement("button");
        btn.className = "killbtn";
        btn.textContent = "✕";
        btn.onclick = () => { STATE.timers = STATE.timers.filter((x) => x.id !== t.id); renderTimers(); };
        chip.appendChild(btn);
        list.appendChild(chip);
    });
}

function timerEngineTick() {
    const now = Date.now();
    $$(".timer-left").forEach((el) => {
        const left = Math.max(0, (+el.dataset.end || 0) - now);
        const h = Math.floor(left / 3600000), m = Math.floor((left % 3600000) / 60000), s = Math.floor((left % 60000) / 1000);
        el.textContent = h > 0 ? `${h}:${pad2(m)}:${pad2(s)}` : `${m}:${pad2(s)}`;
    });
    const fired = STATE.timers.filter((t) => t.endsAt <= now);
    if (fired.length) {
        STATE.timers = STATE.timers.filter((t) => t.endsAt > now);
        renderTimers();
        fired.forEach((t) => {
            fx.timerDone();
            toast(`${t.label} — time elapsed`, "warning");
            const line = `${t.label} has elapsed, Sir. Punctuality — the polish of kings.`;
            addMsg("jarvis", line);
            speak(line);
        });
    }
}

/* ══ E.D.I.T.H. vision engine ═══════════════════════════════════════════════ */
const EDITH = {
    targets: [],
    stream: null,
    optics: "synthetic",
    scan: { active: false, t0: 0 },
    fps: 60,
    started: false,
};

function edithLog(msg) {
    const host = $("#edithLog");
    const empty = $(".alert-empty", host);
    if (empty) empty.remove();
    const d = new Date();
    const row = document.createElement("div");
    row.className = "edith-log-row";
    row.textContent = `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}  ${msg}`;
    host.prepend(row);
    while (host.children.length > 24) host.lastChild.remove();
}

function edithTargetsSeed() {
    const TAGS = ["PERSON", "SUBJECT", "OBJECT", "DRONE"];
    if (EDITH.targets.length) return;
    EDITH.targets = Array.from({ length: 4 }).map((_, i) => ({
        x: 0.2 + Math.random() * 0.6, y: 0.25 + Math.random() * 0.5,
        vx: (Math.random() - 0.5) * 0.0009, vy: (Math.random() - 0.5) * 0.0007,
        r: 0.05 + Math.random() * 0.035,
        label: i === 0 ? "PERSON" : TAGS[i % TAGS.length],
        conf: 88 + Math.random() * 11,
        locked: i === 0,
    }));
}

let edithScanBusy = false;
function triggerEdithScan() {
    setMode("edith");
    if (edithScanBusy) return;
    edithScanBusy = true;
    fx.notify();
    EDITH.scan = { active: true, t0: performance.now() };
    edithLog("E.D.I.T.H. optical sweep initiated");
    const steps = [
        [700, "Frame analysis — depth pass OK"],
        [1500, `${EDITH.targets.length} entities isolated in viewport`],
        [2400, "Biometric match: SIR — confidence 99.4%"],
        [3100, "No hostile signatures. Room is green."],
    ];
    steps.forEach(([d, m]) => setTimeout(() => edithLog(m), d));
    const people = EDITH.targets.filter((t) => t.label === "PERSON").length;
    const others = EDITH.targets.length - people;
    const summary = `E.D.I.T.H. vision sweep complete, Sir. I detect ${people} person${people === 1 ? "" : "s"} in frame — biometrics confirm your identity at ninety-nine point four percent. ${others} other object${others === 1 ? "" : "s"} catalogued. No hostile signatures detected.`;
    setTimeout(() => { addMsg("jarvis", summary); speak(summary); }, 1300);
    setTimeout(() => { EDITH.scan.active = false; edithScanBusy = false; }, 3800);
}

async function toggleOptics() {
    if (EDITH.optics === "live") {
        if (EDITH.stream) EDITH.stream.getTracks().forEach((t) => t.stop());
        EDITH.stream = null;
        EDITH.optics = "synthetic";
        $("#opticsChip").textContent = "SYNTHETIC VIEWPORT";
        $("#opticsChip").classList.remove("on");
        $("#opticsBtn").textContent = "ENABLE LIVE OPTICS";
        edithLog("Optical feed disengaged — synthetic viewport restored");
        return;
    }
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 960 }, audio: false });
        EDITH.stream = stream;
        const v = $("#camVideo");
        v.srcObject = stream;
        await v.play().catch(() => { });
        EDITH.optics = "live";
        $("#opticsChip").textContent = "CAMERA FEED";
        $("#opticsChip").classList.add("on");
        $("#opticsBtn").textContent = "DISENGAGE OPTICS";
        edithLog("Optical feed ONLINE — live camera engaged");
        fx.notify();
    } catch {
        edithLog("Optical feed unavailable — engaging synthetic viewport");
    }
}

function startEdith() {
    if (EDITH.started) return;
    EDITH.started = true;
    edithTargetsSeed();
    const canvas = $("#edithCanvas");
    const ctx = canvas.getContext("2d");
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    let frames = 0, fpsT = performance.now();
    const resize = () => {
        const r = canvas.getBoundingClientRect();
        if (r.width) { canvas.width = r.width * dpr; canvas.height = r.height * dpr; }
    };
    window.addEventListener("resize", resize);

    const draw = (now) => {
        requestAnimationFrame(draw);
        if (!canvas.offsetParent) return; // hidden — idle
        if (!canvas.width) resize();
        const W = canvas.width, H = canvas.height, t = now / 1000;
        frames++;
        if (now - fpsT > 1000) { EDITH.fps = frames; frames = 0; fpsT = now; }

        // Scene
        const v = $("#camVideo");
        if (EDITH.optics === "live" && v.readyState >= 2) {
            ctx.save();
            ctx.translate(W, 0); ctx.scale(-1, 1);
            const s = Math.max(W / v.videoWidth, H / v.videoHeight);
            ctx.drawImage(v, (W - v.videoWidth * s) / 2, (H - v.videoHeight * s) / 2, v.videoWidth * s, v.videoHeight * s);
            ctx.restore();
            ctx.fillStyle = "rgba(0,40,60,.28)";
            ctx.fillRect(0, 0, W, H);
        } else {
            const g = ctx.createRadialGradient(W / 2, H * 0.42, 10, W / 2, H / 2, Math.max(W, H) * 0.75);
            g.addColorStop(0, "#06202e"); g.addColorStop(1, "#010508");
            ctx.fillStyle = g;
            ctx.fillRect(0, 0, W, H);
            ctx.fillStyle = "rgba(20,90,120,.10)";
            for (const tg of EDITH.targets) {
                ctx.beginPath();
                ctx.ellipse(tg.x * W, tg.y * H, tg.r * W * 0.7, tg.r * H * 1.6, 0, 0, Math.PI * 2);
                ctx.fill();
            }
        }

        // Grid + vignette
        ctx.strokeStyle = "rgba(0,190,255,.06)";
        ctx.lineWidth = dpr;
        const step = 44 * dpr;
        for (let x = 0; x < W; x += step) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
        for (let y = 0; y < H; y += step) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
        const vg = ctx.createRadialGradient(W / 2, H / 2, H / 3, W / 2, H / 2, H);
        vg.addColorStop(0, "rgba(0,0,0,0)"); vg.addColorStop(1, "rgba(0,4,8,.65)");
        ctx.fillStyle = vg;
        ctx.fillRect(0, 0, W, H);

        // Targets
        ctx.font = `${10 * dpr}px "Share Tech Mono", monospace`;
        for (const tg of EDITH.targets) {
            tg.x += tg.vx; tg.y += tg.vy;
            if (tg.x < 0.12 || tg.x > 0.88) tg.vx *= -1;
            if (tg.y < 0.14 || tg.y > 0.82) tg.vy *= -1;
            tg.conf = Math.min(99.6, Math.max(87, tg.conf + (Math.random() - 0.5) * 0.6));
            const cx = tg.x * W, cy = tg.y * H;
            const w = tg.r * W * 1.5 * (tg.locked ? 1 + Math.sin(t * 4) * 0.04 : 1);
            const col = tg.locked ? "rgba(255,196,107,.95)" : "rgba(0,225,255,.85)";
            const k = w * 0.3;
            ctx.strokeStyle = col;
            ctx.lineWidth = 1.4 * dpr;
            for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
                ctx.beginPath();
                ctx.moveTo(cx + sx * w - sx * k, cy + sy * w);
                ctx.lineTo(cx + sx * w, cy + sy * w);
                ctx.lineTo(cx + sx * w, cy + sy * w - sy * k);
                ctx.stroke();
            }
            const label = `${tg.label} ${tg.conf.toFixed(1)}%`;
            const tw = ctx.measureText(label).width + 12 * dpr;
            ctx.fillStyle = "rgba(2,16,24,.85)";
            ctx.fillRect(cx + w * 0.5, cy - w - 10 * dpr, tw, 15 * dpr);
            ctx.strokeStyle = col;
            ctx.lineWidth = dpr;
            ctx.strokeRect(cx + w * 0.5, cy - w - 10 * dpr, tw, 15 * dpr);
            ctx.fillStyle = col;
            ctx.fillText(label, cx + w * 0.5 + 6 * dpr, cy - w + 1 * dpr);
            if (tg.locked) {
                ctx.beginPath();
                ctx.moveTo(cx, cy - w - 10 * dpr); ctx.lineTo(cx, cy - w - 26 * dpr);
                ctx.stroke();
                ctx.fillText("SUBJECT LOCK", cx - ctx.measureText("SUBJECT LOCK").width / 2, cy - w - 30 * dpr);
            }
        }

        // Scan sweep
        if (EDITH.scan.active) {
            const p = ((now - EDITH.scan.t0) / 3600) % 1;
            const y = p * H;
            const gg = ctx.createLinearGradient(0, y - 60 * dpr, 0, y);
            gg.addColorStop(0, "rgba(0,225,255,0)");
            gg.addColorStop(1, "rgba(0,225,255,.30)");
            ctx.fillStyle = gg;
            ctx.fillRect(0, y - 60 * dpr, W, 60 * dpr);
            ctx.fillStyle = "rgba(140,250,255,.9)";
            ctx.fillRect(0, y - 1 * dpr, W, 2 * dpr);
        }

        // Frame corners
        ctx.strokeStyle = "rgba(0,210,255,.55)";
        ctx.lineWidth = 1.6 * dpr;
        const c = 26 * dpr;
        const pts = [[10 * dpr, 10 * dpr, 1, 1], [W - 10 * dpr, 10 * dpr, -1, 1], [W - 10 * dpr, H - 10 * dpr, -1, -1], [10 * dpr, H - 10 * dpr, 1, -1]];
        for (const [x, y, sx, sy] of pts) {
            ctx.beginPath();
            ctx.moveTo(x, y + sy * c);
            ctx.lineTo(x, y);
            ctx.lineTo(x + sx * c, y);
            ctx.stroke();
        }
        // Crosshair
        ctx.strokeStyle = "rgba(0,210,255,.35)";
        ctx.beginPath();
        ctx.arc(W / 2, H / 2, 34 * dpr, 0, Math.PI * 2);
        ctx.moveTo(W / 2 - 52 * dpr, H / 2); ctx.lineTo(W / 2 - 20 * dpr, H / 2);
        ctx.moveTo(W / 2 + 20 * dpr, H / 2); ctx.lineTo(W / 2 + 52 * dpr, H / 2);
        ctx.moveTo(W / 2, H / 2 - 52 * dpr); ctx.lineTo(W / 2, H / 2 - 20 * dpr);
        ctx.moveTo(W / 2, H / 2 + 20 * dpr); ctx.lineTo(W / 2, H / 2 + 52 * dpr);
        ctx.stroke();

        // Readouts
        ctx.fillStyle = "rgba(120,235,255,.85)";
        ctx.font = `${11 * dpr}px "Share Tech Mono", monospace`;
        ctx.fillText("E.D.I.T.H. VISION — LIVE", 18 * dpr, 30 * dpr);
        ctx.fillText(`${new Date().toLocaleTimeString("en-GB")}.${String(Math.floor((now % 1000) / 100))}`, 18 * dpr, 46 * dpr);
        const right = `FPS ${EDITH.fps}  ·  ${EDITH.optics.toUpperCase()} OPTICS  ·  TARGETS ${EDITH.targets.length}`;
        ctx.fillText(right, W - 18 * dpr - ctx.measureText(right).width, 30 * dpr);
        const stat = EDITH.scan.active ? "STATUS: SWEEPING…" : "STATUS: TRACKING";
        ctx.fillText(stat, W - 18 * dpr - ctx.measureText(stat).width, H - 20 * dpr);
    };
    requestAnimationFrame(draw);
}

/* ══ Archives drawer ════════════════════════════════════════════════════════ */
async function openDrawer() {
    fx.click();
    $("#drawer").classList.remove("dnone");
    await searchDrawer("");
}
async function searchDrawer(q) {
    try {
        const d = await api(`/api/history?q=${encodeURIComponent(q)}`);
        const list = $("#drawerList");
        list.innerHTML = "";
        if (!(d.items || []).length) list.innerHTML = '<div class="alert-empty">No records match.</div>';
        (d.items || []).forEach((row) => {
            const wrap = document.createElement("div");
            wrap.className = `msg ${row.role}`;
            const tag = document.createElement("span");
            tag.className = "msg-tag";
            tag.textContent = row.role === "jarvis" ? "JARVIS" : "YOU";
            const bubble = document.createElement("div");
            bubble.className = "msg-bubble";
            bubble.textContent = row.content;
            const time = document.createElement("span");
            time.className = "msg-time";
            time.textContent = new Date(row.createdAt).toLocaleString("en-GB");
            wrap.append(tag, bubble, time);
            list.appendChild(wrap);
        });
    } catch { /* noop */ }
}

/* ══ Clock ══════════════════════════════════════════════════════════════════ */
function startClock() {
    const tick = () => {
        const d = new Date();
        $("#clockHM").textContent = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
        $("#clockS").textContent = pad2(d.getSeconds());
        $("#clockDate").textContent = d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).toUpperCase();
    };
    tick();
    setInterval(tick, 1000);
}

/* ══ Boot sequence ══════════════════════════════════════════════════════════ */
const BOOT_LINES = [
    ["STARK INDUSTRIES — UNIFIED OPERATING SHELL v48.2", "dim"],
    ["> Initialising J.A.R.V.I.S. kernel", "ok"],
    ["> Mounting arc reactor interface", "ok"],
    ["> Neural heuristics lattice", "online"],
    ["> Personality matrix  [WIT 0.82 · FORMAL 0.95]", "ok"],
    ["> FRIDAY tactical daemon", "armed"],
    ["> E.D.I.T.H. optical array", "standby"],
    ["> Perimeter defence grid", "secure"],
    ["> Memory banks — PostgreSQL archive", "synced"],
    ["> Audio interface calibration", "ok"],
    ["> Voice authentication: SIR", "granted"],
];

async function runBootSequence() {
    $("#bootIdle").classList.add("dnone");
    $("#bootRun").classList.remove("dnone");
    const log = $("#bootLog");
    const reactor = $("#bootReactor");
    for (let i = 0; i < BOOT_LINES.length; i++) {
        const [text, tone] = BOOT_LINES[i];
        const row = document.createElement("div");
        row.className = "boot-line";
        const txt = document.createElement("span");
        txt.textContent = text;
        row.appendChild(txt);
        if (tone !== "dim") {
            const tag = document.createElement("span");
            tag.className = `boot-tag t-${tone}`;
            tag.textContent = tone.toUpperCase();
            row.appendChild(tag);
        }
        log.appendChild(row);
        const pct = Math.round(((i + 1) / BOOT_LINES.length) * 100);
        $("#bootBar").style.width = pct + "%";
        $("#bootPct").textContent = `LOADING CORE MODULES — ${pct}%`;
        reactor.className = `boot-reactor reactor-host lvl-${Math.ceil(pct / 25)}`;
        await sleep(i === 0 ? 420 : 300 + (i % 3) * 90);
    }
    const caret = document.createElement("div");
    caret.className = "boot-line boot-caret";
    $("#bootPct").textContent = "";
    await sleep(620);
    fx.online();
    $("#bootOnline").classList.remove("dnone");
    await sleep(1600);
    $("#bootOverlay").classList.add("boot-fade");
    await sleep(700);
    $("#bootOverlay").classList.add("dnone");
    startApp();
}

/* ══ App start (post-boot) ══════════════════════════════════════════════════ */
let appStarted = false;
function startApp() {
    if (appStarted) return;
    appStarted = true;
    setStatus("online");

    mic = new MicEngine({
        onCommand: (t) => { if (t) void send(t); },
        onWake: () => {
            fx.wake();
            addMsg("jarvis", "Yes, Sir?");
            speak("Yes, Sir?");
        },
        onInterim: (t) => showInterim(t),
        onError: (m) => { toast(m, "critical"); setWake(false); },
    });

    // Greeting briefing — revealed with the BlurText effect.
    (async () => {
        try {
            const d = await api("/api/briefing");
            addMsg("jarvis", d.text, { fxKind: "blur" });
            speak(d.text);
        } catch {
            addMsg("jarvis", "Systems online, Sir. How may I assist?");
            speak("Systems online, Sir. How may I assist?");
        }
    })();

    void loadTodos();
    void loadAlerts();
    void loadWeather();
    void loadNews();
    void pollTelemetry();
    setInterval(pollTelemetry, 2000);
    setInterval(loadAlerts, 12000);
    setInterval(timerEngineTick, 500);

    if (navigator.getBattery) {
        navigator.getBattery().then((b) => {
            const upd = () => { STATE.battery = b.level; STATE.charging = b.charging; };
            upd();
            b.addEventListener("levelchange", upd);
            b.addEventListener("chargingchange", upd);
        }).catch(() => { });
    }
}

/* ══ Wake / voice toggles ═══════════════════════════════════════════════════ */
function setWake(on) {
    STATE.wakeOn = on;
    $("#wakeState").textContent = on ? "ARMED" : "OFF";
    $("#wakeBtn").classList.toggle("on", on);
    if (mic) mic.setWakeEnabled(on);
    setStatus(on ? "listening" : "online");
    if (on) toast("Wake word armed — say “Jarvis”", "info");
}

/* ══ Wiring ═════════════════════════════════════════════════════════════════ */
function wireUI() {
    $("#bootBtn").addEventListener("click", () => { fx.ensure(); fx.startup(); void runBootSequence(); });
    $("#cmdForm").addEventListener("submit", (e) => { e.preventDefault(); void send($("#cmdInput").value); });
    $("#micBtn").addEventListener("click", () => {
        if (!mic || !mic.supported) { toast("Speech recognition is not supported in this browser — typed directives work perfectly, Sir.", "warning"); return; }
        fx.wake();
        setStatus("listening");
        mic.startPtt();
    });
    $$("#quickDock .qbtn").forEach((b) => b.addEventListener("click", () => void send(b.dataset.cmd)));
    $$("#modeTabs .mode-tab").forEach((b) => b.addEventListener("click", () => setMode(b.dataset.mode)));
    $("#wakeBtn").addEventListener("click", () => { fx.click(); setWake(!STATE.wakeOn); });
    $("#voiceBtn").addEventListener("click", () => {
        STATE.voiceOn = !STATE.voiceOn;
        $("#voiceBtn").classList.toggle("on", STATE.voiceOn);
        fx.enabled = STATE.voiceOn;
        if (!STATE.voiceOn) voice.stop();
    });
    $("#archBtn").addEventListener("click", () => void openDrawer());
    $("#drawerClose").addEventListener("click", () => $("#drawer").classList.add("dnone"));
    $("#drawer").addEventListener("click", (e) => { if (e.target.id === "drawer") $("#drawer").classList.add("dnone"); });
    let searchTimer = null;
    $("#drawerSearch").addEventListener("input", (e) => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => void searchDrawer(e.target.value), 320);
    });
    $("#scanBtn").addEventListener("click", () => void runScan());
    $("#ackAllBtn").addEventListener("click", () => void ackAlert(undefined, true));
    $("#opticsBtn").addEventListener("click", () => void toggleOptics());
    $("#taskForm").addEventListener("submit", (e) => {
        e.preventDefault();
        const v = $("#taskInput").value.trim();
        if (v) { void addTodo(v); $("#taskInput").value = ""; }
    });
}

/* ══ Instrumentation construction ═══════════════════════════════════════════ */
function buildGauges() {
    gauges.cpu = makeGauge($("#railGauges"), { label: "CPU", size: 84 });
    gauges.mem = makeGauge($("#railGauges"), { label: "RAM", size: 84 });
    gauges.disk = makeGauge($("#railGauges"), { label: "DISK", size: 84 });
    gauges.fCpu = makeGauge($("#fridayGauges"), { label: "CPU LOAD", size: 96 });
    gauges.fMem = makeGauge($("#fridayGauges"), { label: "MEMORY", size: 96 });
    gauges.fDisk = makeGauge($("#fridayGauges"), { label: "STORAGE", size: 96 });
    gauges.fGpu = makeGauge($("#fridayGauges"), { label: "GPU CORE", size: 96 });
    gauges.fNet = makeGauge($("#fridayGauges"), { label: "DOWNLINK", size: 96 });
    sparks = {
        cpu: makeSpark($("#cpuSpark"), "cyan"),
        fCpu: makeSpark($("#fCpuSpark"), "cyan"),
        fNet: makeSpark($("#fNetSpark"), "green"),
    };
}

/* ══ Init ═══════════════════════════════════════════════════════════════════ */
function init() {
    mountReactors();
    buildGauges();
    startWaveform();
    startEdith();
    startClock();
    wireUI();
    setStatus("boot");
    $$(".reactor").forEach((r) => {
        const isBoot = r.closest("#bootIdle, #bootRun");
        r.setAttribute("class", `reactor ${isBoot ? "st-boot" : "st-processing"}`);
    });
    // React Bits–style entrance: SplitText on the wordmark, BlurText on the tagline.
    const reveal = () => {
        splitTextReveal($("#bootTitle"), {
            delay: 95, duration: 0.85,
            from: { opacity: 0, y: 70, rotateX: -85 },
            onComplete: () => console.log("[JARVIS] wordmark letters animated"),
        });
        setTimeout(() => blurTextIn($("#bootSub"), { delay: 60, stepDuration: 0.3 }), 500);
    };
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => setTimeout(reveal, 150));
    else setTimeout(reveal, 400);
}

document.addEventListener("DOMContentLoaded", init);
