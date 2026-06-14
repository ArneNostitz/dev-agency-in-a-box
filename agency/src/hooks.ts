/**
 * Deterministic pre/post hooks (v3) — shell steps the orchestrator runs around an agent, zero
 * tokens. The Process Analyzer writes these to replace repeating mechanical work the agent keeps
 * doing by hand. Best-effort: a hook failure never breaks the run (it's logged).
 */
import { execFile } from "node:child_process";
import { listHooks } from "./store.js";
import { ghBotToken } from "./creds.js";

/** Run all enabled hooks for `target` at `phase` ("pre" | "post") in `workdir`. */
export async function runHooks(target: string, phase: "pre" | "post", workdir: string, log: (s: string) => void = () => {}): Promise<void> {
  const hooks = listHooks(target, phase);
  if (!hooks.length) return;
  const token = ghBotToken();
  const env = { ...process.env, ...(token ? { GH_TOKEN: token, GITHUB_TOKEN: token } : {}) };
  for (const h of hooks) {
    await new Promise<void>((resolve) => {
      execFile("bash", ["-lc", h.command], { cwd: workdir, env, timeout: 120_000, maxBuffer: 4 * 1024 * 1024 }, (err) => {
        log(`⚙️ ${phase}-hook ${err ? "✗" : "✓"}: ${h.command.slice(0, 80)}`);
        resolve();
      });
    });
  }
}
