import { Hono } from "hono";
import type { Env } from "../types";
import { requireAuth } from "../lib/auth";

export const agentRoutes = new Hono<{ Bindings: Env }>();
agentRoutes.use("*", requireAuth());

agentRoutes.get("/schema", (c) =>
  c.json({
    name: "bh-crm",
    version: 1,
    auth: "Authorization: Bearer <AGENT_API_KEY> — full parity with the human UI",
    conventions: {
      stages: ["new", "contacted", "quoted", "scheduled", "customer", "lost"],
      phones: "E.164 (+1XXXXXXXXXX)",
      timestamps: "ISO-8601 UTC",
    },
    endpoints: [
      { method: "GET", path: "/api/health", description: "Liveness check (public)" },
      { method: "POST", path: "/api/lead", description: "Public lead capture (CORS-gated). Body: {name, phone, email, vehicle, message?, source, source_detail, ts, website}" },
      { method: "POST", path: "/api/auth/login", description: "Body {password} -> session cookie" },
      { method: "GET", path: "/api/contacts", description: "List. Query: search, stage, source, tag, limit (<=200), offset. Returns {items, total}" },
      { method: "POST", path: "/api/contacts", description: "Create. Body: {first_name?, last_name?, email?, phone?, address?, city?, stage?, source?, tags?, custom?}" },
      { method: "GET", path: "/api/contacts/:id", description: "Full contact + vehicles + parsed tags/custom" },
      { method: "PATCH", path: "/api/contacts/:id", description: "Partial update; custom shallow-merges; stage change logs stage_changed" },
      { method: "DELETE", path: "/api/contacts/:id", description: "Delete contact (cascades vehicles/activities)" },
      { method: "GET", path: "/api/contacts/:id/activities", description: "Timeline, newest first, limit 100" },
      { method: "POST", path: "/api/contacts/:id/activities", description: "Log manual touch. Body {type: note|call_logged|sms_logged, title, payload?}" },
      { method: "POST", path: "/api/contacts/bulk", description: "Import up to 200. Body {contacts:[...]} -> {created, merged, errors}" },
      { method: "GET", path: "/api/custom-fields", description: "List custom field definitions" },
      { method: "POST", path: "/api/custom-fields", description: "Body {key, label, type: text|number|select|date|checkbox, options?, sort?}" },
      { method: "DELETE", path: "/api/custom-fields/:key", description: "Remove a custom field definition" },
      { method: "GET", path: "/api/stats", description: "{byStage, recent} dashboard numbers" },
      { method: "GET", path: "/api/agent/schema", description: "This document" },
    ],
  })
);
