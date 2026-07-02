/**
 * Operational settings, resolved DB-first → env var → built-in default. This lets the operator
 * manage them from the dashboard (stored in SQLite) instead of Coolify env vars. Env values are
 * kept only as a fallback so existing deployments keep working until the settings are saved once.
 *
 * Bootstrap/infra (RUN_MODE, PORT, DB_PATH, MASTER_KEY, APP_ENV, GITHUB_WEBHOOK_SECRET, admin
 * seed) and the execution credentials (GitHub/Claude tokens — moving to per-user) are NOT here.
 */
import { getSetting } from "./store.js";

export function sStr(key: string, env: string, def: string): string {
  const s = getSetting(key);
  if (s != null && s !== "") return s;
  const e = process.env[env]?.trim();
  return e && e !== "" ? e : def;
}
export function sNum(key: string, env: string, def: number): number {
  const s = getSetting(key);
  if (s != null && s !== "" && Number.isFinite(Number(s))) return Number(s);
  const e = Number(process.env[env]?.trim());
  return Number.isFinite(e) ? e : def;
}
export function sBool(key: string, env: string, def: boolean): boolean {
  const s = getSetting(key);
  if (s === "on" || s === "true" || s === "1") return true;
  if (s === "off" || s === "false" || s === "0") return false;
  const e = process.env[env]?.trim().toLowerCase();
  if (e === undefined || e === "") return def;
  return e === "1" || e === "true" || e === "yes" || e === "on";
}

/**
 * The operational settings exposed in the dashboard's "Operations" panel. Each entry maps a DB
 * key to its env fallback + type, so the UI and the /settings endpoint stay in sync with one list.
 */
export const OPS_SETTINGS = [
  { key: "github_owner", env: "GITHUB_OWNER", type: "str", def: "", label: "GitHub owner / org" },
  { key: "concurrency", env: "AGENCY_CONCURRENCY", type: "num", def: 3, label: "Max concurrent runs" },
  { key: "poll_interval_seconds", env: "POLL_INTERVAL_SECONDS", type: "num", def: 60, label: "Poll interval (seconds, watch mode)" },
  { key: "followup_window_days", env: "FOLLOWUP_WINDOW_DAYS", type: "num", def: 21, label: "Re-engage closed threads within (days)" },
  { key: "max_issue_cost_usd", env: "MAX_ISSUE_COST_USD", type: "num", def: 15, label: "Max $ per issue (0 = off)" },
  { key: "max_issue_turns", env: "MAX_ISSUE_TURNS", type: "num", def: 800, label: "Max agent turns per issue" },
  { key: "max_turns_per_run", env: "MAX_TURNS_PER_RUN", type: "num", def: 250, label: "Max turns per single run" },
  { key: "gitnexus_index_timeout_ms", env: "GITNEXUS_INDEX_TIMEOUT_MS", type: "num", def: 180000, label: "GitNexus index timeout (ms)" },
  { key: "gitnexus_analyze_args", env: "GITNEXUS_ANALYZE_ARGS", type: "str", def: "", label: "GitNexus analyze args" },
  { key: "self_improve", env: "SELF_IMPROVE", type: "bool", def: true, label: "Allow self-improvement PRs" },
  { key: "lessons_pr_threshold", env: "LESSONS_PR_THRESHOLD", type: "num", def: 5, label: "Lessons before a self-improve PR" },
  { key: "agency_repo", env: "AGENCY_REPO", type: "str", def: "dev-agency", label: "Agency's own repo (self-improve target)" },
  { key: "preview_ttl_min", env: "PREVIEW_TTL_MIN", type: "num", def: 30, label: "Preview server TTL (minutes)" },
  { key: "preview_url_template", env: "PREVIEW_URL_TEMPLATE", type: "str", def: "", label: "Preview URL template" },
  { key: "skip_ci", env: "SKIP_CI", type: "bool", def: true, label: "Append [skip ci] to agency commits" },
  { key: "public_url", env: "PUBLIC_URL", type: "str", def: "", label: "Public base URL (webhook auto-register)" },
  { key: "graceful_shutdown_ms", env: "GRACEFUL_SHUTDOWN_MS", type: "num", def: 570000, label: "Graceful shutdown drain (ms)" },
] as const;

/** Read every ops setting's effective value (for the dashboard to render the form). */
export function opsSettingsValues(): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const s of OPS_SETTINGS) {
    if (s.type === "num") out[s.key] = sNum(s.key, s.env, s.def as number);
    else if (s.type === "bool") out[s.key] = sBool(s.key, s.env, s.def as boolean);
    else out[s.key] = sStr(s.key, s.env, s.def as string);
  }
  return out;
}
