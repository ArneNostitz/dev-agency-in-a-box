#!/usr/bin/env node
// Reset the secrets-encryption MASTER_KEY for a self-hosted Dev Agency instance.
//
//   Run inside the container's terminal:   node scripts/reset-master-key.mjs
//   (add --yes to skip the confirmation prompt)
//
// What it does: WIPES every encrypted secret (each user's tokens + global secret settings) and all
// login sessions, then removes the persisted auto-generated key so a FRESH MASTER_KEY is generated
// on the next restart. You then re-run onboarding to re-enter your tokens.
//
// Why wipe? Once the key changes, the old ciphertext can't be decrypted anyway — so we clear it to
// avoid the silent 401 fallback and let you start clean.
//
// NOTE: if you pinned MASTER_KEY as an environment variable, this can't rotate it on its own —
// change/remove it in your host/Coolify env too, otherwise the same key keeps being used.

import { DatabaseSync } from "node:sqlite";
import { existsSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

const dbPath = process.env.DB_PATH?.trim() || "/app/data/agency.db";
const keyFile = join(dirname(dbPath), ".masterkey");

async function confirm() {
  if (process.argv.includes("--yes") || process.env.CONFIRM === "yes") return true;
  if (!stdin.isTTY) {
    console.error('Refusing to run non-interactively. Re-run with --yes:  node scripts/reset-master-key.mjs --yes');
    return false;
  }
  const rl = createInterface({ input: stdin, output: stdout });
  const ans = (await rl.question('This WIPES all stored tokens + sessions and rotates the key. Type "RESET" to confirm: ')).trim();
  rl.close();
  return ans === "RESET";
}

if (!(await confirm())) {
  console.log("Aborted — nothing changed.");
  process.exit(1);
}

if (existsSync(dbPath)) {
  const db = new DatabaseSync(dbPath);
  const del = (sql) => {
    try {
      return db.prepare(sql).run().changes ?? 0;
    } catch {
      return 0;
    }
  };
  const secrets = del("DELETE FROM user_secrets");
  const secretSettings = del("DELETE FROM settings WHERE key LIKE 'secret.%'");
  const sessions = del("DELETE FROM sessions");
  db.close();
  console.log(`Cleared ${secrets} user secret(s), ${secretSettings} global secret(s), ${sessions} session(s) from ${dbPath}.`);
} else {
  console.log(`No DB at ${dbPath} (nothing to clear).`);
}

if (existsSync(keyFile)) {
  rmSync(keyFile, { force: true });
  console.log(`Removed persisted key file ${keyFile}.`);
} else {
  console.log(`No persisted key file at ${keyFile}.`);
}

console.log("\nNext steps:");
if (process.env.MASTER_KEY?.trim()) {
  console.log("  • MASTER_KEY is pinned via an env var — change/remove it in your host/Coolify env to actually rotate the key.");
}
console.log("  • Restart the container (a fresh MASTER_KEY auto-generates if not pinned).");
console.log("  • Log in and re-run onboarding (Settings → Setup wizard) to re-enter your tokens.");
