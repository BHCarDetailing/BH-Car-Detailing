import { Hono } from "hono";
import type { Env } from "./types";
import { authRoutes } from "./routes/auth";
import { publicRoutes } from "./routes/public";
import { contactRoutes, statsRoutes } from "./routes/contacts";
import { activityWriteRoutes, bulkRoutes, customFieldRoutes } from "./routes/misc";
import { agentRoutes } from "./routes/agent";

const app = new Hono<{ Bindings: Env }>();

app.route("/api", publicRoutes);
app.route("/api/auth", authRoutes);
app.route("/api/contacts", bulkRoutes);          // POST /api/contacts/bulk (mounted BEFORE :id routes)
app.route("/api/contacts", activityWriteRoutes); // POST /api/contacts/:id/activities
app.route("/api/contacts", contactRoutes);
app.route("/api/custom-fields", customFieldRoutes);
app.route("/api/stats", statsRoutes);
app.route("/api/agent", agentRoutes);

export default app;
