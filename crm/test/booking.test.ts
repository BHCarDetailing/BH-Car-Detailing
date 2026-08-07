import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { availableSlots, slotIsFree } from "../src/lib/booking";

const DATE = "2027-01-04"; // a Monday, in default business days

describe("self-booking", () => {
  it("availableSlots returns future slots on a business day", async () => {
    const slots = await availableSlots(env, DATE);
    expect(slots.length).toBeGreaterThan(0);
    expect(slots.every((s) => !Number.isNaN(Date.parse(s)))).toBe(true);
  });

  it("books a priced slot, marks it taken, and rejects a double-book", async () => {
    const first = (await availableSlots(env, DATE))[0];
    expect(await slotIsFree(env, first)).toBe(true);

    const res = await SELF.fetch("http://x/api/book/quote", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        vehicle_type: "sedan", lines: [{ service_id: "svc_washwax", qty: 1 }],
        scheduled_start: first, first_name: "Sam", last_name: "Booker", phone: "3055557788",
        sms_opt_in: true, ts: Date.now() - 3000,
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as { status: string; total_cents: number };
    expect(body.status).toBe("scheduled");
    expect(body.total_cents).toBeGreaterThan(0);

    expect(await slotIsFree(env, first)).toBe(false);
    const again = await SELF.fetch("http://x/api/book/quote", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        vehicle_type: "sedan", lines: [{ service_id: "svc_washwax", qty: 1 }],
        scheduled_start: first, first_name: "Other", last_name: "", phone: "3055550000",
        sms_opt_in: true, ts: Date.now() - 3000,
      }),
    });
    expect(again.status).toBe(409);
  });

  it("a requires_planning service skips the slot check and comes back quoted", async () => {
    const res = await SELF.fetch("http://x/api/book/quote", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        vehicle_type: "sedan", lines: [{ service_id: "svc_ppf", qty: 1 }],
        first_name: "Planner", last_name: "", phone: "3055559999",
        sms_opt_in: true, ts: Date.now() - 3000,
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as { status: string };
    expect(body.status).toBe("quoted");
  });

  it("requires consent, a vehicle + service, and a valid slot", async () => {
    const base = { vehicle_type: "sedan", lines: [{ service_id: "svc_washwax", qty: 1 }], scheduled_start: "2027-01-04T15:00:00.000Z", phone: "3055551111", ts: Date.now() - 3000 };
    // missing consent
    expect((await SELF.fetch("http://x/api/book/quote", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(base) })).status).toBe(400);
    // missing vehicle_type
    expect((await SELF.fetch("http://x/api/book/quote", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...base, vehicle_type: undefined, sms_opt_in: true }) })).status).toBe(400);
    // missing slot
    expect((await SELF.fetch("http://x/api/book/quote", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...base, scheduled_start: undefined, sms_opt_in: true }) })).status).toBe(400);
  });

  it("saves an incomplete lead without booking anything", async () => {
    const res = await SELF.fetch("http://x/api/book/lead", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Drop Off", phone: "3055552222" }),
    });
    expect(res.status).toBe(200);
    const contact = await env.DB.prepare("SELECT source, email_opt_in FROM contacts WHERE phone = ?").bind("+13055552222").first();
    expect(contact?.source).toBe("quote-wizard-incomplete");
    expect(contact?.email_opt_in).toBe(0);
  });

  it("availability rejects a bad date", async () => {
    expect((await SELF.fetch("http://x/api/book/availability?date=nope")).status).toBe(400);
  });
});
