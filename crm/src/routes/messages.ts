import { Hono } from "hono";
import type { Env } from "../types";
import { all, one, run } from "../lib/db";
import { logActivity } from "../lib/activity";
import { requireAuth } from "../lib/auth";
import { sendSms } from "../lib/sms";

export const messageRoutes = new Hono<{ Bindings: Env }>();
messageRoutes.use("*", requireAuth());

// Inbox: latest SMS per contact, newest first.
messageRoutes.get("/inbox", async (c) => {
  const items = await all(
    c.env.DB,
    `SELECT m.*, ct.first_name, ct.last_name, ct.phone
     FROM messages m
     JOIN contacts ct ON ct.id = m.contact_id
     JOIN (
       SELECT contact_id, MAX(id) AS max_id
       FROM messages WHERE channel = 'sms' AND contact_id IS NOT NULL
       GROUP BY contact_id
     ) last ON last.contact_id = m.contact_id AND last.max_id = m.id
     ORDER BY m.id DESC LIMIT 100`
  );
  return c.json({ items });
});

// Thread for one contact (ascending).
messageRoutes.get("/", async (c) => {
  const contactId = c.req.query("contact_id");
  if (!contactId) return c.json({ error: "contact_id_required" }, 400);
  const limit = Math.min(Number(c.req.query("limit")) > 0 ? Number(c.req.query("limit")) : 200, 500);
  const items = await all(
    c.env.DB,
    `SELECT * FROM messages
     WHERE channel = 'sms' AND contact_id = ?
     ORDER BY id ASC LIMIT ?`,
    contactId, limit
  );
  return c.json({ items });
});

// Send an SMS to a contact (or log via the bridge when Twilio unconfigured).
messageRoutes.post("/", async (c) => {
  const b = ((await c.req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  const contactId = typeof b.contact_id === "string" ? b.contact_id : "";
  const body = typeof b.body === "string" ? b.body.trim() : "";
  if (!contactId || !body) return c.json({ error: "contact_and_body_required" }, 400);
  const contact = await one<{ id: string; phone: string | null; stage: string }>(
    c.env.DB, "SELECT id, phone, stage FROM contacts WHERE id = ?", contactId);
  if (!contact) return c.json({ error: "contact_not_found" }, 404);
  if (!contact.phone) return c.json({ error: "no_phone" }, 400);

  const r = await sendSms(c.env, { contactId, toPhone: contact.phone, body });
  await logActivity(c.env.DB, {
    contactId, type: "sms_logged",
    title: `Texted ${contact.phone} (${r.status})`,
    payload: { message_id: r.id, direction: "outbound", status: r.status },
    actor: c.req.header("Authorization")?.startsWith("Bearer ") ? "agent" : "human",
  });
  if (contact.stage === "new") {
    await run(c.env.DB, "UPDATE contacts SET stage = 'contacted' WHERE id = ? AND stage = 'new'", contactId);
  }
  return c.json({ id: r.id, status: r.status });
});
