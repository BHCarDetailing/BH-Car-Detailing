import { Hono } from "hono";
import type { Env } from "./types";
import { authRoutes } from "./routes/auth";
import { requireAuth } from "./lib/auth";

const app = new Hono<{ Bindings: Env }>();

app.get("/api/health", (c) => c.json({ ok: true, ts: new Date().toISOString() }));
app.route("/api/auth", authRoutes);

// placeholder — replaced with real contacts routes in Task 6
app.get("/api/contacts", requireAuth(), (c) => c.json({ items: [], total: 0 }));

export default app;
