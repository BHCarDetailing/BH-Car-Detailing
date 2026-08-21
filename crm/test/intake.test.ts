import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { one, run, uuid } from "../src/lib/db";

const AUTH = { Authorization: "Bearer dev-agent-key", "Content-Type": "application/json" };

async function firstServiceId(): Promise<string> {
  const r = await one<{ id: string }>(env.DB, "SELECT id FROM services WHERE is_addon = 0 AND active = 1 ORDER BY sort LIMIT 1");
  return r!.id;
}

/** The two-step handoff: Max creates the intent, the customer completes it. */
async function createIntent(overrides: Record<string, unknown> = {}) {
  const svc = await firstServiceId();
  const res = await SELF.fetch("http://x/api/quote-builder/intent", {
    method: "POST", headers: AUTH,
    body: JSON.stringify({ vehicle_type: "mid_suv", vehicle_notes: "Blue Explorer", service_ids: [svc], ...overrides }),
  });
  expect(res.status).toBe(201);
  return (await res.json()) as { token: string };
}

describe("POST /api/quote-builder/intent", () => {
  it("requires auth", async () => {
    const r = await SELF.fetch("http://x/api/quote-builder/intent", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ vehicle_type: "sedan", service_ids: ["x"] }),
    });
    expect(r.status).toBe(401);
  });

  it("rejects a missing vehicle type or service", async () => {
    const noVehicle = await SELF.fetch("http://x/api/quote-builder/intent", {
      method: "POST", headers: AUTH, body: JSON.stringify({ service_ids: ["x"] }) });
    expect(noVehicle.status).toBe(400);

    const noService = await SELF.fetch("http://x/api/quote-builder/intent", {
      method: "POST", headers: AUTH, body: JSON.stringify({ vehicle_type: "sedan", service_ids: [] }) });
    expect(noService.status).toBe(400);
  });

  it("creates a token the customer can open", async () => {
    const { token } = await createIntent();
    expect(token).toMatch(/^[a-f0-9]{32}$/);
  });
});

describe("GET /api/intent/:token", () => {
  it("is public and shows the priced summary Max chose", async () => {
    const { token } = await createIntent();
    const r = await SELF.fetch(`http://x/api/intent/${token}`);
    expect(r.status).toBe(200);
    const body = (await r.json()) as {
      vehicle_label: string; vehicle_note: string; items: unknown[]; total_cents: number; completed: boolean;
    };
    expect(body.vehicle_label).toBe("Mid SUV");
    expect(body.vehicle_note).toBe("Blue Explorer");
    expect(body.items.length).toBeGreaterThan(0);
    expect(body.total_cents).toBeGreaterThan(0);
    expect(body.completed).toBe(false);
  });

  it("404s on an unknown token", async () => {
    const r = await SELF.fetch("http://x/api/intent/does-not-exist");
    expect(r.status).toBe(404);
  });

  it("shows planned work as quote-only with no schedulable price assumption", async () => {
    const ppf = await one<{ id: string }>(env.DB, "SELECT id FROM services WHERE requires_planning = 1 LIMIT 1");
    if (!ppf) return;
    const { token } = await createIntent({ service_ids: [ppf.id] });
    const body = (await (await SELF.fetch(`http://x/api/intent/${token}`)).json()) as { requires_planning: boolean };
    expect(body.requires_planning).toBe(true);
  });
});

describe("POST /api/intent/:token/complete", () => {
  const fill = (over: Record<string, unknown> = {}) => ({
    first_name: "Dana", last_name: "Ortiz", phone: "+13055559301",
    address: "1 Bay Rd", city: "Miami", state: "FL", zip: "33131",
    ts: Date.now() - 5000, ...over,
  });

  it("books a job from the customer's own submission", async () => {
    const { token } = await createIntent();
    const start = new Date(Date.now() + 86_400_000).toISOString();
    const res = await SELF.fetch(`http://x/api/intent/${token}/complete`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fill({ scheduled_start: start, sms_opt_in: true })),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { ok: boolean; job_id: string; contact_id: string; status: string };
    expect(body.ok).toBe(true);
    expect(body.status).toBe("scheduled");

    const job = await one<{ status: string; scheduled_start: string }>(
      env.DB, "SELECT status, scheduled_start FROM jobs WHERE id = ?", body.job_id);
    expect(job?.status).toBe("scheduled");
    expect(job?.scheduled_start).toBe(start);

    const contact = await one<{ sms_opt_in: number; source: string }>(
      env.DB, "SELECT sms_opt_in, source FROM contacts WHERE id = ?", body.contact_id);
    expect(contact?.sms_opt_in).toBe(1);
  });

  it("is single-use — a second submission on the same token is refused", async () => {
    const { token } = await createIntent();
    const first = await SELF.fetch(`http://x/api/intent/${token}/complete`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(fill({ phone: "+13055559302" })),
    });
    expect(first.status).toBe(201);

    const second = await SELF.fetch(`http://x/api/intent/${token}/complete`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(fill({ phone: "+13055559303" })),
    });
    expect(second.status).toBe(409);
    const body = (await second.json()) as { error: string };
    expect(body.error).toBe("already_used");
  });

  it("404s completing an unknown token", async () => {
    const r = await SELF.fetch("http://x/api/intent/nope/complete", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(fill()),
    });
    expect(r.status).toBe(404);
  });

  it("rejects a submission that fills in under 2 seconds (bot guard)", async () => {
    const { token } = await createIntent();
    const r = await SELF.fetch(`http://x/api/intent/${token}/complete`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fill({ phone: "+13055559304", ts: Date.now() })),
    });
    expect(r.status).toBe(400);
  });

  it("silently accepts but ignores a honeypot submission", async () => {
    const { token } = await createIntent();
    const r = await SELF.fetch(`http://x/api/intent/${token}/complete`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fill({ phone: "+13055559305", website: "http://spam.example" })),
    });
    expect(r.status).toBe(200);
    const intent = await one<{ completed_job_id: string | null }>(
      env.DB, "SELECT completed_job_id FROM quote_intents WHERE token = ?", token);
    expect(intent?.completed_job_id).toBeNull();
  });

  it("never schedules planned work, even if the customer picks a time", async () => {
    const ppf = await one<{ id: string }>(env.DB, "SELECT id FROM services WHERE requires_planning = 1 LIMIT 1");
    if (!ppf) return;
    const { token } = await createIntent({ service_ids: [ppf.id] });
    const res = await SELF.fetch(`http://x/api/intent/${token}/complete`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fill({ phone: "+13055559306", scheduled_start: new Date(Date.now() + 86_400_000).toISOString() })),
    });
    const body = (await res.json()) as { status: string; job_id: string };
    expect(body.status).toBe("quoted");
    const job = await one<{ scheduled_start: string | null }>(env.DB, "SELECT scheduled_start FROM jobs WHERE id = ?", body.job_id);
    expect(job?.scheduled_start).toBeNull();
  });

  it("requires a phone or email", async () => {
    const { token } = await createIntent();
    const r = await SELF.fetch(`http://x/api/intent/${token}/complete`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fill({ phone: undefined })),
    });
    expect(r.status).toBe(400);
  });
});

describe("GET /api/intent/:token after completion", () => {
  it("reports the real outcome on reload, not a generic guess", async () => {
    const { token } = await createIntent();
    const start = new Date(Date.now() + 86_400_000).toISOString();
    await SELF.fetch(`http://x/api/intent/${token}/complete`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        first_name: "Reload", phone: "+13055559307", ts: Date.now() - 5000, scheduled_start: start,
      }),
    });

    const r = await SELF.fetch(`http://x/api/intent/${token}`);
    const body = (await r.json()) as { completed: boolean; completed_status: string };
    expect(body.completed).toBe(true);
    expect(body.completed_status).toBe("scheduled");   // not a fallback "quoted"
  });
});

describe("expenses and equipment collections", () => {
  it("creates and lists an expense", async () => {
    const r = await SELF.fetch("http://x/api/c/expenses", {
      method: "POST", headers: AUTH,
      body: JSON.stringify({ label: "Ceramic sealant", amount_cents: 8900, category: "supplies", occurred_at: "2026-07-01", vendor: "Chemical Guys" }),
    });
    expect(r.status).toBe(201);
    const list = (await (await SELF.fetch("http://x/api/c/expenses", { headers: AUTH })).json()) as { items: Array<{ label: string; amount_cents: number }> };
    expect(list.items.some((i) => i.label === "Ceramic sealant" && i.amount_cents === 8900)).toBe(true);
  });

  it("rejects an unknown expense category", async () => {
    const r = await SELF.fetch("http://x/api/c/expenses", {
      method: "POST", headers: AUTH,
      body: JSON.stringify({ label: "Mystery cost", amount_cents: 100, category: "not_a_real_category" }),
    });
    expect(r.status).toBe(400);
  });

  it("creates, updates and marks equipment purchased", async () => {
    const create = await SELF.fetch("http://x/api/c/equipment", {
      method: "POST", headers: AUTH,
      body: JSON.stringify({ name: "Pressure washer", category: "washing", est_cost_cents: 25000, priority: "must_have" }),
    });
    expect(create.status).toBe(201);
    const { item } = (await create.json()) as { item: { id: string } };

    const update = await SELF.fetch(`http://x/api/c/equipment/${item.id}`, {
      method: "PATCH", headers: AUTH, body: JSON.stringify({ purchased: true, purchased_at: new Date().toISOString() }),
    });
    expect(update.status).toBe(200);

    const list = (await (await SELF.fetch("http://x/api/c/equipment", { headers: AUTH })).json()) as { items: Array<{ id: string; purchased: number | boolean }> };
    const row = list.items.find((i) => i.id === item.id);
    expect(Number(row?.purchased)).toBe(1);
  });
});

describe("intake respects real availability", () => {
  it("rejects a slot that is already blocked by a Google event", async () => {
    const { availableSlots } = await import("../src/lib/booking");
    const DATE = "2027-04-05"; // a Monday
    await env.DB.prepare("DELETE FROM gcal_busy").run();

    const target = (await availableSlots(env, DATE))[0];
    expect(target).toBeTruthy();

    await env.DB.prepare(
      `INSERT INTO gcal_busy (id, calendar_id, summary, starts_at, ends_at, all_day, is_block, synced_at)
       VALUES ('intake-probe@cal','cal','Dentist',?,?,0,0,?)`
    ).bind(target, new Date(Date.parse(target) + 3600_000).toISOString(), new Date().toISOString()).run();

    const { token } = await createIntent();
    const res = await SELF.fetch(`http://x/api/intent/${token}/complete`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        first_name: "Slot", last_name: "Clash", phone: "3055554321",
        scheduled_start: target, sms_opt_in: true, ts: Date.now() - 3000,
      }),
    });

    expect(res.status).toBe(409);
    expect((await res.json() as { error: string }).error).toBe("slot_taken");
    await env.DB.prepare("DELETE FROM gcal_busy WHERE id = 'intake-probe@cal'").run();
  });

  it("accepts the same slot once the blocking event is gone", async () => {
    const { availableSlots } = await import("../src/lib/booking");
    await env.DB.prepare("DELETE FROM gcal_busy").run();
    const target = (await availableSlots(env, "2027-04-12"))[0];

    const { token } = await createIntent();
    const res = await SELF.fetch(`http://x/api/intent/${token}/complete`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        first_name: "Clear", last_name: "Booking", phone: "3055556789",
        scheduled_start: target, sms_opt_in: true, ts: Date.now() - 3000,
      }),
    });

    expect(res.status).toBe(201);
    expect((await res.json() as { status: string }).status).toBe("scheduled");
  });
});
