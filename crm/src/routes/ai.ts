import { Hono } from "hono";
import type { Env } from "../types";
import { requireAuth } from "../lib/auth";
import { askCrm, draftMessage, generateDigest } from "../lib/ai";

export const aiRoutes = new Hono<{ Bindings: Env }>();
aiRoutes.use("*", requireAuth());

aiRoutes.post("/draft", async (c) => {
  const b = ((await c.req.json().catch(() => null)) ?? {}) as { contact_id?: string; channel?: string };
  if (!b.contact_id) return c.json({ error: "contact_id_required" }, 400);
  if (!c.env.ANTHROPIC_API_KEY) return c.json({ error: "ai_not_configured" }, 503);
  const text = await draftMessage(c.env, b.contact_id, b.channel === "email" ? "email" : "sms");
  if (text == null) return c.json({ error: "draft_failed" }, 502);
  return c.json({ text });
});

aiRoutes.get("/digest", async (c) => c.json(await generateDigest(c.env)));

aiRoutes.post("/ask", async (c) => {
  const b = ((await c.req.json().catch(() => null)) ?? {}) as { question?: string; history?: Array<{ role: string; text: string }> };
  const q = (b.question ?? "").trim();
  if (!q) return c.json({ error: "question_required" }, 400);
  if (q.length > 2000) return c.json({ error: "question_too_long" }, 400);
  if (!c.env.ANTHROPIC_API_KEY) return c.json({ error: "ai_not_configured" }, 503);
  const text = await askCrm(c.env, q, Array.isArray(b.history) ? b.history : undefined);
  if (text == null) return c.json({ error: "ask_failed" }, 502);
  return c.json({ text });
});
