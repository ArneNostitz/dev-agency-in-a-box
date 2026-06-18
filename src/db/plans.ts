import { getDb, now } from "./connection.js";

export function recordPlan(repo: string, number: number, plan: string): void {
  const d = getDb();
  if (!d) return;
  try {
    d.prepare(`INSERT INTO plans (repo, number, plan, created_at) VALUES (?, ?, ?, ?)`).run(
      repo,
      number,
      plan,
      now(),
    );
  } catch (err) {
    console.warn("[agency] memory write (plan) failed:", (err as Error).message);
  }
}

export function lastPlan(repo: string, number: number): string | null {
  const d = getDb();
  if (!d) return null;
  try {
    const row = d
      .prepare(`SELECT plan FROM plans WHERE repo = ? AND number = ? ORDER BY id DESC LIMIT 1`)
      .get(repo, number) as { plan?: string } | undefined;
    return row?.plan ?? null;
  } catch {
    return null;
  }
}
