import { Hono } from "hono";
import type { Env } from "./types";
import { authRoutes } from "./routes/auth";
import { publicRoutes } from "./routes/public";
import { contactRoutes, statsRoutes } from "./routes/contacts";
import { activityWriteRoutes, bulkRoutes, customFieldRoutes, settingsRoutes } from "./routes/misc";
import { agentRoutes } from "./routes/agent";
import { jobRoutes } from "./routes/jobs";
import { taskRoutes } from "./routes/tasks";
import { messageRoutes } from "./routes/messages";
import { sequenceRoutes } from "./routes/sequences";
import { runReminders } from "./lib/reminders";
import { runSequences } from "./lib/sequences";

const app = new Hono<{ Bindings: Env }>();

app.route("/api", publicRoutes);
app.route("/api/auth", authRoutes);
app.route("/api/contacts", bulkRoutes);          // POST /api/contacts/bulk (mounted BEFORE :id routes)
app.route("/api/contacts", activityWriteRoutes); // POST /api/contacts/:id/activities
app.route("/api/contacts", contactRoutes);
app.route("/api/custom-fields", customFieldRoutes);
app.route("/api/settings", settingsRoutes);
app.route("/api/stats", statsRoutes);
app.route("/api/jobs", jobRoutes);
app.route("/api/tasks", taskRoutes);
app.route("/api/messages", messageRoutes);
app.route("/api/sequences", sequenceRoutes);
app.route("/api/agent", agentRoutes);

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(Promise.all([
      runReminders(env, Date.now()),
      runSequences(env, Date.now()),
    ]).then(() => undefined));
  },
};
