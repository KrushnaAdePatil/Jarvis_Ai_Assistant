"""
JARVIS Information Engine — weather (Open-Meteo, keyless), tech news
(HackerNews Algolia, keyless) and Wikipedia summaries. Every call has a
hard timeout and a graceful offline fallback so JARVIS never goes silent.
"""
from __future__ import annotations

import requests
import time

TIMEOUT = 5
_HEADERS = {"User-Agent": "JARVIS-Interface/2.0"}


def _get(url: str, retries: int = 2, backoff: float = 0.5):
    for attempt in range(retries):
        try:
            r = requests.get(url, headers=_HEADERS, timeout=TIMEOUT)
            if r.ok:
                return r.json()
        except requests.exceptions.RequestException as e:
            if attempt < retries - 1:
                time.sleep(backoff * (attempt + 1))
    return None


_WMO = {
    0: "clear skies", 1: "mostly clear skies", 2: "scattered clouds",
    3: "overcast conditions", 45: "fog", 48: "icy fog",
    51: "light drizzle", 53: "drizzle", 55: "heavy drizzle",
    61: "light rain", 63: "rain", 65: "heavy rain",
    66: "freezing rain", 67: "heavy freezing rain",
    71: "light snow", 73: "snowfall", 75: "heavy snow",
    80: "scattered showers", 81: "showers", 82: "violent showers",
    95: "a thunderstorm", 96: "a thunderstorm with hail", 99: "a severe thunderstorm",
}


def weather_desc(code: int) -> str:
    return _WMO.get(code, "unsettled conditions")


def get_weather(city: str = "London") -> dict:
    from urllib.parse import quote
    geo = _get(f"https://geocoding-api.open-meteo.com/v1/search?name={quote(city)}&count=1&language=en&format=json")
    loc = (geo or {}).get("results") or []
    if loc:
        loc = loc[0]
        wx = _get(
            "https://api.open-meteo.com/v1/forecast"
            f"?latitude={loc['latitude']}&longitude={loc['longitude']}"
            "&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m"
            "&timezone=auto"
        )
        cur = (wx or {}).get("current")
        if cur:
            return {
                "city": loc["name"],
                "temp": round(cur["temperature_2m"]),
                "feels": round(cur["apparent_temperature"]),
                "humidity": round(cur["relative_humidity_2m"]),
                "wind": round(cur["wind_speed_10m"]),
                "code": cur["weather_code"],
                "desc": weather_desc(cur["weather_code"]),
            }
    # Offline fallback — plausible, always useful.
    return {
        "city": city[:1].upper() + city[1:], "temp": 21, "feels": 20,
        "humidity": 54, "wind": 12, "code": 1, "desc": "clear skies", "isFallback": True,
    }


_FALLBACK_NEWS = [
    {"title": "Stark Industries unveils next-generation clean arc reactor", "url": "https://news.ycombinator.com", "source": "FRIDAY Wire"},
    {"title": "Breakthrough in neural-interface latency achieves sub-millisecond response", "url": "https://news.ycombinator.com", "source": "FRIDAY Wire"},
    {"title": "Global satellite mesh network completes final orbital deployment", "url": "https://news.ycombinator.com", "source": "FRIDAY Wire"},
    {"title": "Quantum encryption standard ratified by international coalition", "url": "https://news.ycombinator.com", "source": "FRIDAY Wire"},
    {"title": "Autonomous rescue drones credited with record disaster response time", "url": "https://news.ycombinator.com", "source": "FRIDAY Wire"},
    {"title": "New alloy doubles repulsor efficiency in laboratory trials", "url": "https://news.ycombinator.com", "source": "FRIDAY Wire"},
    {"title": "AI systems pass collaborative engineering certification", "url": "https://news.ycombinator.com", "source": "FRIDAY Wire"},
    {"title": "Open-source holographic display drivers gain traction", "url": "https://news.ycombinator.com", "source": "FRIDAY Wire"},
]


def get_news(count: int = 10) -> list[dict]:
    data = _get(f"https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage={count}")
    hits = (data or {}).get("hits") or []
    if hits:
        return [
            {
                "title": h.get("title") or "Untitled",
                "url": h.get("url") or f"https://news.ycombinator.com/item?id={h.get('objectID')}",
                "source": "Hacker News",
            }
            for h in hits[:count]
        ]
    return _FALLBACK_NEWS[:count]


def get_wiki_summary(query: str) -> dict | None:
    title = query.strip().replace(" ", "_")
    data = _get(f"https://en.wikipedia.org/api/rest_v1/page/summary/{title}")
    if data and data.get("extract") and data.get("title"):
        extract = data["extract"]
        if len(extract) > 600:
            extract = extract[:600].rsplit(" ", 1)[0] + "…"
        return {
            "title": data["title"],
            "extract": extract,
            "url": (data.get("content_urls", {}).get("desktop", {}) or {}).get("page", ""),
        }
    return None
