/**
 * pi's native auth store. The agency "logs in" to a pi provider by writing the user's API key into
 * pi's REAL auth file (~/.pi/agent/auth.json) under the provider's documented key — this is exactly
 * what pi's own /login does, per docs/providers.md. pi then knows the provider's endpoint + model
 * catalog; we just run `pi --provider <key>` / `pi --list-models --provider <key>`.
 *
 * We MERGE (read-modify-write), never clobber, so multiple providers and the user's own pi config
 * coexist. No isolated per-provider dir, no PI_CODING_AGENT_DIR — pi reads its default location.
 *
 * auth.json schema (from pi docs): { "<piKey>": { "type": "api_key", "key": "..." }, ... }
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/** pi's real auth file path (~/.pi/agent/auth.json), the store pi's /login writes to. */
export function piAuthFile(): string {
  return join(homedir(), ".pi", "agent", "auth.json");
}

interface PiAuthEntry { type: "api_key"; key: string; }
type PiAuthStore = Record<string, PiAuthEntry>;

/** Read pi's auth.json as an object ({} if missing/unreadable). */
function readPiAuth(): PiAuthStore {
  try {
    const f = piAuthFile();
    if (!existsSync(f)) return {};
    return JSON.parse(readFileSync(f, "utf8")) as PiAuthStore;
  } catch {
    return {};
  }
}

/** Write the full auth object back with 0600 perms (pi's own convention), creating the dir. */
function writePiAuth(store: PiAuthStore): void {
  const f = piAuthFile();
  mkdirSync(dirname(f), { recursive: true });
  writeFileSync(f, JSON.stringify(store, null, 2));
  try { chmodSync(f, 0o600); } catch { /* best-effort on filesystems that don't support it */ }
}

/**
 * Register (or replace) one provider's API key in pi's auth.json. Merges — other providers' keys
 * are preserved. This IS the login: after this, `pi --provider <piKey>` and `pi --list-models
 * --provider <piKey>` authenticate against that provider.
 */
export function writePiAuthKey(piKey: string, apiKey: string): void {
  if (!piKey || !apiKey) return;
  const store = readPiAuth();
  store[piKey] = { type: "api_key", key: apiKey };
  writePiAuth(store);
}

/** Remove one provider's key from pi's auth.json (leaves the rest intact). */
export function removePiAuthKey(piKey: string): void {
  if (!piKey) return;
  const store = readPiAuth();
  if (!(piKey in store)) return;
  delete store[piKey];
  // If nothing remains, remove the file so pi doesn't keep an empty stub.
  if (Object.keys(store).length === 0) {
    try { unlinkSync(piAuthFile()); } catch { /* best-effort */ }
    return;
  }
  writePiAuth(store);
}
