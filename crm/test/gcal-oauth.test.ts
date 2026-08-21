import { env, SELF, fetchMock } from "cloudflare:test";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

const AUTH = { Authorization: "Bearer dev-agent-key", "Content-Type": "application/json" };

beforeAll(() => { fetchMock.activate(); fetchMock.disableNetConnect(); });
afterEach(() => fetchMock.assertNoPendingInterceptors());

/** A connected account with a still-valid access token, so nothing triggers a refresh. */
async function connectedWith(refreshToken: string) {
  await env.DB.prepare("DELETE FROM oauth_tokens").run();
  await env.DB.prepare(
    `INSERT INTO oauth_tokens (provider, refresh_token, access_token, expires_at, account_email, created_at, updated_at)
     VALUES ('google', ?, 'at', ?, 'a@b.com', 'x', 'x')`
  ).bind(refreshToken, Date.now() + 300_000).run();
}

describe("google oauth routes", () => {
  beforeEach(async () => { await env.DB.prepare("DELETE FROM oauth_tokens").run(); });

  it("every endpoint except the callback requires auth", async () => {
    for (const p of ["/connect", "/status", "/events", "/sync", "/disconnect"]) {
      expect((await SELF.fetch(`http://x/api/settings/google${p}`)).status).toBe(401);
    }
  });

  it("connect returns a consent URL with offline access and the events scope", async () => {
    const res = await SELF.fetch("http://x/api/settings/google/connect", { headers: AUTH });
    expect(res.status).toBe(200);
    const { url } = await res.json() as { url: string };
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(u.searchParams.get("access_type")).toBe("offline");
    expect(u.searchParams.get("prompt")).toBe("consent");
    // Both scopes are required: events alone 403s on /users/me/calendarList.
    const scopes = (u.searchParams.get("scope") ?? "").split(" ");
    expect(scopes).toContain("https://www.googleapis.com/auth/calendar.events");
    expect(scopes).toContain("https://www.googleapis.com/auth/calendar.readonly");
    // Never the broad `calendar` scope — that grants creating/deleting calendars.
    expect(scopes).not.toContain("https://www.googleapis.com/auth/calendar");
    expect(u.searchParams.get("redirect_uri")).toBe("https://bh-crm.bhdev.workers.dev/api/settings/google/callback");
    expect(u.searchParams.get("state")).toBeTruthy();
  });

  it("the callback rejects a forged state", async () => {
    const res = await SELF.fetch("http://x/api/settings/google/callback?code=abc&state=forged");
    expect(res.status).toBe(400);
    const n = await env.DB.prepare("SELECT COUNT(*) n FROM oauth_tokens").first<{ n: number }>();
    expect(n?.n).toBe(0);
  });

  it("a real state round-trips into a stored refresh token", async () => {
    const { url } = await (await SELF.fetch("http://x/api/settings/google/connect", { headers: AUTH })).json() as { url: string };
    const state = new URL(url).searchParams.get("state")!;

    fetchMock.get("https://oauth2.googleapis.com").intercept({ path: "/token", method: "POST" })
      .reply(200, { access_token: "at", refresh_token: "rt-new", expires_in: 3600 });
    fetchMock.get("https://www.googleapis.com").intercept({ path: /calendarList/ })
      .reply(200, { items: [{ id: "a@b.com", summary: "a@b.com", primary: true }] });

    const res = await SELF.fetch(
      `http://x/api/settings/google/callback?code=abc&state=${encodeURIComponent(state)}`,
      { redirect: "manual" });
    expect(res.status).toBe(302);

    const row = await env.DB.prepare("SELECT refresh_token, account_email FROM oauth_tokens WHERE provider='google'").first();
    expect(row?.refresh_token).toBe("rt-new");
    expect(row?.account_email).toBe("a@b.com");
  });

  it("status never leaks the refresh token", async () => {
    await connectedWith("SUPERSECRET");
    fetchMock.get("https://www.googleapis.com").intercept({ path: /calendarList/ })
      .reply(200, { items: [{ id: "a@b.com", summary: "a@b.com", primary: true }] });

    const res = await SELF.fetch("http://x/api/settings/google/status", { headers: AUTH });
    const text = await res.text();
    expect(text).not.toContain("SUPERSECRET");
    expect(JSON.parse(text).connected).toBe(true);
  });

  it("GET /api/settings never leaks the refresh token either", async () => {
    await connectedWith("SUPERSECRET");
    const res = await SELF.fetch("http://x/api/settings", { headers: AUTH });
    expect(await res.text()).not.toContain("SUPERSECRET");
  });

  it("disconnect revokes at Google and clears local state", async () => {
    await connectedWith("rt");
    await env.DB.prepare(
      `INSERT INTO gcal_busy (id, calendar_id, starts_at, ends_at, all_day, is_block, synced_at)
       VALUES ('e@c','c','2027-01-01T00:00:00.000Z','2027-01-01T01:00:00.000Z',0,0,'x')`
    ).run();
    fetchMock.get("https://oauth2.googleapis.com").intercept({ path: /revoke/, method: "POST" }).reply(200, "");

    const res = await SELF.fetch("http://x/api/settings/google/disconnect", { method: "POST", headers: AUTH });
    expect(res.status).toBe(200);

    const tokens = await env.DB.prepare("SELECT COUNT(*) n FROM oauth_tokens").first<{ n: number }>();
    const busy = await env.DB.prepare("SELECT COUNT(*) n FROM gcal_busy").first<{ n: number }>();
    expect(tokens?.n).toBe(0);
    expect(busy?.n).toBe(0);
  });
});
