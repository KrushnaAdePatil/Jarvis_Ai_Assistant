import type { NextConfig } from "next";

/**
 * Next.js is a thin host shell:
 *   /            → serves the vanilla HTML/CSS/JS HUD from /public/hud
 *   /api/health  → platform healthcheck (kept native)
 *   /api/<rest>  → proxied to the Python (FastAPI) backend on :8777,
 *                  which is spawned by src/instrumentation.ts at server start.
 */
const PY = "http://127.0.0.1:8777";

const PY_ROUTES = [
  "/api/command",
  "/api/telemetry",
  "/api/weather",
  "/api/news",
  "/api/briefing",
  "/api/history",
  "/api/todos",
  "/api/alerts",
  "/api/security",
];

const nextConfig: NextConfig = {
  async rewrites() {
    return {
      beforeFiles: [],
      afterFiles: [
        { source: "/", destination: "/hud/index.html" },
        ...PY_ROUTES.map((p) => ({ source: p, destination: `${PY}${p}` })),
      ],
      fallback: [],
    };
  },
};

export default nextConfig;
