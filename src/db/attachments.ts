/**
 * Local-first attachments. Images/files pasted or picked in the dashboard are stored as bytes in the
 * DB (the source of truth) and served from /attach/<id> — NOT committed to the GitHub repo. This is
 * instant, collision-free (concurrent repo commits used to drop all but one image), and keeps the
 * repo history clean. GitHub only ever gets a reference (the body text), never the bytes. Blobs for
 * a done issue can be flushed after a retention window (flushOldAttachments).
 */
import { getDb, now } from "./connection.js";
import { randomUUID } from "node:crypto";

export interface Attachment { id: string; name: string; mime: string; bytes: Buffer; }

/** Store a file's bytes; returns the id used in the /attach/<id> URL. */
export function putAttachment(repo: string, number: number, name: string, mime: string, bytes: Buffer): string {
  const d = getDb();
  const id = randomUUID().replace(/-/g, "").slice(0, 20);
  if (!d) return id;
  d.prepare(`INSERT INTO attachments (id, repo, number, name, mime, bytes, size, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, repo, number, name, mime, bytes, bytes.length, now());
  return id;
}

/** Read a stored attachment by id (for GET /attach/<id>). */
export function getAttachment(id: string): Attachment | null {
  const d = getDb();
  if (!d) return null;
  const row = d.prepare(`SELECT id, name, mime, bytes FROM attachments WHERE id = ?`).get(id) as
    | { id: string; name: string; mime: string; bytes: Uint8Array }
    | undefined;
  if (!row) return null;
  return { id: row.id, name: row.name, mime: row.mime, bytes: Buffer.from(row.bytes) };
}

/** Delete attachment blobs older than `days` (housekeeping — call periodically). Returns count. */
export function flushOldAttachments(days = 7): number {
  const d = getDb();
  if (!d) return 0;
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
  const r = d.prepare(`DELETE FROM attachments WHERE created_at < ? AND number >= 0`).run(cutoff); // number<0 = permanent (e.g. agent avatars)
  return Number(r.changes ?? 0);
}
