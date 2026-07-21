import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

const AUTH = { Authorization: "Bearer dev-agent-key", "Content-Type": "application/json" };

describe("iCloud calendar feed", () => {
  it("serves scheduled jobs to a valid token and 404s a bad token", async () => {
    const cid = ((await (await SELF.fetch("http://x/api/contacts", { method: "POST", headers: AUTH, body: JSON.stringify({ first_name: "Cal", email: "cal@x.com" }) })).json()) as { id: string }).id;
    await SELF.fetch("http://x/api/jobs", { method: "POST", headers: AUTH, body: JSON.stringify({ contact_id: cid, title: "Ceramic feed job", status: "scheduled", scheduled_start: "2026-08-20T15:00:00.000Z", scheduled_end: "2026-08-20T17:00:00.000Z" }) });
    await SELF.fetch("http://x/api/settings", { method: "PUT", headers: AUTH, body: JSON.stringify({ key: "ics_feed_token", value: "feedtoken123456" }) });

    const good = await SELF.fetch("http://x/api/calendar/feedtoken123456.ics");
    expect(good.status).toBe(200);
    expect(good.headers.get("Content-Type")).toContain("text/calendar");
    const body = await good.text();
    expect(body).toContain("BEGIN:VCALENDAR");
    expect(body).toContain("Ceramic feed job");
    expect(body).toContain("DTSTART:20260820T150000Z");

    const bad = await SELF.fetch("http://x/api/calendar/wrongtoken.ics");
    expect(bad.status).toBe(404);
  });
});
