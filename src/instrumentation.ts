/**
 * Server instrumentation — boots the Python (FastAPI) backend alongside the
 * Next.js host. Probes first so restarts never double-bind the port.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const g = globalThis as typeof globalThis & { __jarvisPython?: boolean };
  if (g.__jarvisPython) return;
  g.__jarvisPython = true;

  const HEALTH = "http://127.0.0.1:8777/api/health";
  try {
    const res = await fetch(HEALTH, { signal: AbortSignal.timeout(900) });
    if (res.ok) {
      console.log("[jarvis] python backend already online — skipping spawn");
      return;
    }
  } catch {
    /* not running yet */
  }

  try {
    const { spawn } = await import("node:child_process");
    const child = spawn(
      "python3",
      ["-m", "uvicorn", "backend.main:app", "--host", "127.0.0.1", "--port", "8777"],
      {
        cwd: process.cwd(),
        env: process.env,
        detached: true,
        stdio: "ignore",
      }
    );
    child.unref();
    const stop = () => {
      try {
        child.kill("SIGTERM");
      } catch {
        /* already gone */
      }
    };
    // Alias keeps Turbopack's edge-runtime static analysis quiet — this file
    // only ever executes in the Node.js runtime (guarded at the top).
    const proc = process as unknown as { on?: (ev: string, fn: () => void) => void };
    proc.on?.("exit", stop);
    proc.on?.("SIGINT", stop);
    proc.on?.("SIGTERM", stop);
    console.log("[jarvis] python backend spawned on :8777");
  } catch (err) {
    console.error("[jarvis] failed to spawn python backend", err);
  }
}
