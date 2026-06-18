import { getSetting, setSetting } from "./settings.js";

export type AutoKind = "resume" | "merge";

export type AutoValue = "on" | "off" | ""; // "" = inherit (or, at global level, default off)

function autoKey(kind: AutoKind, repo?: string, number?: number): string {
  if (repo && number) return `auto.${kind}.${repo}#${number}`;
  if (repo) return `auto.${kind}.${repo}`;
  return `auto.${kind}`;
}

export function getAutoRaw(kind: AutoKind, repo?: string, number?: number): AutoValue {
  const v = getSetting(autoKey(kind, repo, number));
  return v === "on" || v === "off" ? v : "";
}

export function setAuto(kind: AutoKind, value: AutoValue, repo?: string, number?: number): void {
  setSetting(autoKey(kind, repo, number), value === "on" || value === "off" ? value : "");
}

export function autoEnabled(kind: AutoKind, repo: string, number: number): boolean {
  const i = getAutoRaw(kind, repo, number);
  if (i) return i === "on";
  const r = getAutoRaw(kind, repo);
  if (r) return r === "on";
  return getAutoRaw(kind) === "on";
}

export function autoAttempts(repo: string, number: number): number {
  return Number(getSetting(`auto.attempts.${repo}#${number}`)) || 0;
}

export function bumpAutoAttempts(repo: string, number: number): number {
  const n = autoAttempts(repo, number) + 1;
  setSetting(`auto.attempts.${repo}#${number}`, String(n));
  return n;
}

export function resetAutoAttempts(repo: string, number: number): void {
  setSetting(`auto.attempts.${repo}#${number}`, "0");
}
