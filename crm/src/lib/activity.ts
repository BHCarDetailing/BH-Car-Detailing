import { nowIso, run } from "./db";

export interface ActivityInput {
  contactId: string;
  type: string;
  title: string;
  payload?: unknown;
  actor?: string;
}

export async function logActivity(db: D1Database, a: ActivityInput): Promise<void> {
  const now = nowIso();
  await run(
    db,
    "INSERT INTO activities (contact_id, type, title, payload, actor, created_at) VALUES (?,?,?,?,?,?)",
    a.contactId, a.type, a.title, a.payload ? JSON.stringify(a.payload) : null, a.actor ?? "system", now
  );
  await run(db, "UPDATE contacts SET last_activity_at = ?, updated_at = ? WHERE id = ?", now, now, a.contactId);
}
