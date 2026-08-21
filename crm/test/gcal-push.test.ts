import { env, fetchMock } from "cloudflare:test";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { pushJobEvent, deleteJobEvent, retryFailedPushes } from "../src/lib/gcal";

beforeAll(() => { fetchMock.activate(); fetchMock.disableNetConnect(); });
afterEach(() => fetchMock.assertNoPendingInterceptors());

async function seedJob(id: string) {
  // Deleting the contact cascades to its jobs, so each test starts from one
  // known row rather than inheriting the previous test's.
  await env.DB.prepare("DELETE FROM contacts WHERE id = 'c_push'").run();
  await env.DB.prepare(
    "INSERT INTO contacts (id, first_name, last_name, created_at, updated_at) VALUES ('c_push','Sam','Booker','x','x')"
  ).run();
  await env.DB.prepare(
    `INSERT INTO jobs (id, contact_id, title, status, price_cents, scheduled_start, scheduled_end, address, created_at, updated_at)
     VALUES (?, 'c_push', 'Full Detail', 'scheduled', 25000, '2027-03-01T15:00:00.000Z', '2027-03-01T17:00:00.000Z', '1 Ocean Dr', 'x', 'x')`
  ).bind(id).run();
}

/** Connected, with a still-valid access token so nothing triggers a refresh. */
async function connected() {
  await env.DB.prepare("DELETE FROM oauth_tokens").run();
  await env.DB.prepare(
    `INSERT INTO oauth_tokens (provider, refresh_token, access_token, expires_at, created_at, updated_at)
     VALUES ('google','rt','at',?, 'x','x')`
  ).bind(Date.now() + 300_000).run();
  await env.DB.prepare(
    "INSERT INTO settings (key, value) VALUES ('gcal_write_calendar','a@b.com') ON CONFLICT(key) DO UPDATE SET value='a@b.com'"
  ).run();
}

describe("job push", () => {
  beforeEach(connected);

  it("creates an event tagged with the job id and stores the event id", async () => {
    await seedJob("job_1");
    fetchMock.get("https://www.googleapis.com")
      .intercept({ path: /\/calendars\/.*\/events$/, method: "POST" })
      .reply(200, { id: "gev_1" });

    await pushJobEvent(env, "job_1");
    const row = await env.DB.prepare("SELECT gcal_event_id, gcal_error FROM jobs WHERE id='job_1'").first();
    expect(row?.gcal_event_id).toBe("gev_1");
    expect(row?.gcal_error).toBeNull();
  });

  it("patches the existing event on reschedule instead of creating a second one", async () => {
    await seedJob("job_2");
    await env.DB.prepare("UPDATE jobs SET gcal_event_id='gev_2' WHERE id='job_2'").run();
    fetchMock.get("https://www.googleapis.com")
      .intercept({ path: /\/calendars\/.*\/events\/gev_2$/, method: "PATCH" })
      .reply(200, { id: "gev_2" });

    await pushJobEvent(env, "job_2");
    const row = await env.DB.prepare("SELECT gcal_event_id FROM jobs WHERE id='job_2'").first();
    expect(row?.gcal_event_id).toBe("gev_2");
  });

  it("records the failure on the job and leaves the job intact", async () => {
    await seedJob("job_3");
    fetchMock.get("https://www.googleapis.com")
      .intercept({ path: /\/calendars\/.*\/events$/, method: "POST" }).reply(500, "boom");

    await pushJobEvent(env, "job_3");
    const row = await env.DB.prepare("SELECT status, gcal_error FROM jobs WHERE id='job_3'").first();
    expect(row?.status).toBe("scheduled");
    expect(String(row?.gcal_error)).toMatch(/500/);
  });

  it("the retry pass clears the error on a later success", async () => {
    await seedJob("job_4");
    await env.DB.prepare("UPDATE jobs SET gcal_error='api_error 500' WHERE id='job_4'").run();
    fetchMock.get("https://www.googleapis.com")
      .intercept({ path: /\/calendars\/.*\/events$/, method: "POST" }).reply(200, { id: "gev_4" });

    expect(await retryFailedPushes(env)).toBe(1);
    const row = await env.DB.prepare("SELECT gcal_error, gcal_event_id FROM jobs WHERE id='job_4'").first();
    expect(row?.gcal_error).toBeNull();
    expect(row?.gcal_event_id).toBe("gev_4");
  });

  it("deletes the event and clears the id when a job is cancelled", async () => {
    await seedJob("job_5");
    await env.DB.prepare("UPDATE jobs SET gcal_event_id='gev_5' WHERE id='job_5'").run();
    fetchMock.get("https://www.googleapis.com")
      .intercept({ path: /\/calendars\/.*\/events\/gev_5$/, method: "DELETE" }).reply(204, "");

    await deleteJobEvent(env, "job_5");
    const row = await env.DB.prepare("SELECT gcal_event_id FROM jobs WHERE id='job_5'").first();
    expect(row?.gcal_event_id).toBeNull();
  });

  it("removes the Google event when a job's status leaves the pushable set", async () => {
    await seedJob("job_6");
    await env.DB.prepare("UPDATE jobs SET gcal_event_id='gev_6', status='cancelled' WHERE id='job_6'").run();
    fetchMock.get("https://www.googleapis.com")
      .intercept({ path: /\/calendars\/.*\/events\/gev_6$/, method: "DELETE" }).reply(204, "");

    await pushJobEvent(env, "job_6");
    const row = await env.DB.prepare("SELECT gcal_event_id FROM jobs WHERE id='job_6'").first();
    expect(row?.gcal_event_id).toBeNull();
  });

  it("does nothing for an unscheduled job", async () => {
    await seedJob("job_7");
    await env.DB.prepare("UPDATE jobs SET scheduled_start=NULL WHERE id='job_7'").run();
    await pushJobEvent(env, "job_7");
    const row = await env.DB.prepare("SELECT gcal_event_id FROM jobs WHERE id='job_7'").first();
    expect(row?.gcal_event_id).toBeNull();
  });
});
