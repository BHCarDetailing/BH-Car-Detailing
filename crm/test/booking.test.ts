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

  it("books a slot, marks it taken, and rejects a double-book", async () => {
    const first = (await availableSlots(env, DATE))[0];
    expect(await slotIsFree(env, first)).toBe(true);

    const res = await SELF.fetch("http://x/api/book", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Sam Booker", phone: "3055557788", service: "Full detail", slot_start: first, ts: Date.now() - 3000 }),
    });
    expect(res.status).toBe(200);

    expect(await slotIsFree(env, first)).toBe(false);
    const again = await SELF.fetch("http://x/api/book", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Other", phone: "3055550000", service: "x", slot_start: first, ts: Date.now() - 3000 }),
    });
    expect(again.status).toBe(409);
  });

  it("requires a phone and a valid slot", async () => {
    expect((await SELF.fetch("http://x/api/book", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ service: "x", slot_start: "2027-01-04T15:00:00.000Z", ts: Date.now() - 3000 }) })).status).toBe(400);
    expect((await SELF.fetch("http://x/api/book", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phone: "3055551111", service: "x", ts: Date.now() - 3000 }) })).status).toBe(400);
  });

  it("availability rejects a bad date", async () => {
    expect((await SELF.fetch("http://x/api/book/availability?date=nope")).status).toBe(400);
  });
});
