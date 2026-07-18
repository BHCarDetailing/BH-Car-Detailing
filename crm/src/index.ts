import { Hono } from "hono";
import type { Env } from "./types";
import { authRoutes } from "./routes/auth";
import { publicRoutes } from "./routes/public";
import { requireAuth } from "./lib/auth";

const app = new Hono<{ Bindings: Env }>();

app.route("/api", publicRoutes); // /api/health, /api/lead
app.route("/api/auth", authRoutes);

// placeholder — replaced with real contacts routes in Task 6
app.get("/api/contacts", requireAuth(), (c) => c.json({ items: [], total: 0 }));

export default app;
