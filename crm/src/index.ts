import { Hono } from "hono";
import type { Env } from "./types";
import { authRoutes } from "./routes/auth";
import { publicRoutes } from "./routes/public";
import { contactRoutes, statsRoutes } from "./routes/contacts";

const app = new Hono<{ Bindings: Env }>();

app.route("/api", publicRoutes);
app.route("/api/auth", authRoutes);
app.route("/api/contacts", contactRoutes);
app.route("/api/stats", statsRoutes);

export default app;
