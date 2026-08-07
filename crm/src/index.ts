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
import { aiRoutes } from "./routes/ai";
import { labelRoutes } from "./routes/labels";
import { serviceRoutes } from "./routes/services";
import { collectionRoutes } from "./routes/collections";
import { mediaRoutes } from "./routes/media";
import { emailRoutes } from "./routes/email";
import { rebookRoutes } from "./routes/rebook";
import { growthRoutes } from "./routes/growth";
import { quoteBuilderRoutes } from "./routes/quotebuilder";
import { runReminders } from "./lib/reminders";
import { runSequences } from "./lib/sequences";
import { runRebook } from "./lib/rebook";
import { runTimeTriggers } from "./lib/triggers";
import { runReviewFollowUps } from "./lib/reviews";

const app = new Hono<{ Bindings: Env }>();

app.route("/api", publicRoutes);
app.route("/api/auth", authRoutes);
app.route("/api/contacts", bulkRoutes);          // POST /api/contacts/bulk (mounted BEFORE :id routes)
app.route("/api/contacts", activityWriteRoutes); // POST /api/contacts/:id/activities
app.route("/api/contacts", contactRoutes);
app.route("/api/custom-fields", customFieldRoutes);
app.route("/api/labels", labelRoutes);
app.route("/api/services", serviceRoutes);
app.route("/api/settings", settingsRoutes);
app.route("/api/stats", statsRoutes);
app.route("/api/jobs", jobRoutes);
app.route("/api/tasks", taskRoutes);
app.route("/api/messages", messageRoutes);
app.route("/api/sequences", sequenceRoutes);
app.route("/api/ai", aiRoutes);
app.route("/api/agent", agentRoutes);
app.route("/api/c", collectionRoutes);           // generic operating-system collections
app.route("/api/media", mediaRoutes);            // R2-backed content uploads
app.route("/api/email", emailRoutes);            // one-click test email
app.route("/api/rebook", rebookRoutes);          // due-this-week worklist + offers
app.route("/api/growth", growthRoutes);          // reactivation, reviews, referrals
app.route("/api/quote-builder", quoteBuilderRoutes); // in-person wizard

export default {
  fetch: app.fetch,
  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext) {
    const now = Date.now();
    // The daily 9am-ET pass refreshes the rebook worklist; the 5-minute tick
    // handles time-sensitive appointment reminders and due sequence steps.
    const work = event.cron === "0 13 * * *"
      ? [runRebook(env, now), runTimeTriggers(env, now), runReviewFollowUps(env, now)]
      : [runReminders(env, now), runSequences(env, now)];
    ctx.waitUntil(Promise.all(work).then(() => undefined));
  },
};
