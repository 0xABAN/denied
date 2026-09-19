import { createServer } from "node:net";
import { resolve } from "node:path";

export async function until(check: () => Promise<boolean> | boolean, label: string, timeout = 20000): Promise<void> {
  const deadline = Date.now() + timeout;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(`Timed out: ${label}`);
    await Bun.sleep(50);
  }
}

/** Start the actual application with the user's key. Never substitute an inference service. */
export async function localAPI(extraEnv: Record<string, string> = {}) {
  const reservation = createServer();
  await new Promise<void>(done => reservation.listen(0, "127.0.0.1", done));
  const port = (reservation.address() as { port: number }).port;
  await new Promise<void>((done, fail) => reservation.close(error => error ? fail(error) : done()));
  const url = `http://127.0.0.1:${port}`;
  let process: ReturnType<typeof Bun.spawn> | undefined;

  async function stop() {
    if (!process) return;
    process.kill("SIGTERM");
    await process.exited;
    process = undefined;
  }

  async function start(overrides: Record<string, string> = {}) {
    const envFile = await Bun.file("backend/.env").exists() ? ["--env-file", ".env"] : [];
    process = Bun.spawn(["uv", "run", ...envFile, "uvicorn", "denied.app:app", "--host", "127.0.0.1", "--port", String(port), "--no-access-log"], {
      cwd: resolve("backend"), env: { ...Bun.env, DENIED_RECORD_REMOVALS: "0", ...extraEnv, ...overrides }, stdout: "ignore", stderr: "ignore",
    });
    try {
      await until(async () => {
        if (process?.exitCode !== null) throw new Error("FastAPI failed to start");
        try {
          const health = await fetch(`${url}/health`, { signal: AbortSignal.timeout(500) }).then(r => r.json());
          if (!health.configured) throw new Error("KEY_MISSING");
          return true;
        } catch (error) {
          if (error instanceof Error && error.message === "KEY_MISSING") throw new Error("Configure TYPESAFE_API_KEY in backend/.env; real tests cannot run without it.");
          return false;
        }
      }, "real FastAPI startup");
    } catch (error) { await stop(); throw error; }
  }

  await start();
  return { url, start, stop };
}
