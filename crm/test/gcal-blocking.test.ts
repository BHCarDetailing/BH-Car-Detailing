import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { availableSlots, slotIsFree } from "../src/lib/booking";

const DATE = "2027-02-01"; // a Monday, inside the default business days

async function addBusy(startIso: string, endIso: string, over: { allDay?: boolean; isBlock?: boolean } = {}) {
  await env.DB.prepare(
    `INSERT INTO gcal_busy (id, calendar_id, summary, starts_at, ends_at, all_day, is_block, synced_at)
     VALUES (?,?,?,?,?,?,?,?)`
  ).bind(`b${startIso}`, "cal", "Busy thing", startIso, endIso,
    over.allDay ? 1 : 0, over.isBlock ? 1 : 0, new Date().toISOString()).run();
}

describe("google busy time blocks booking slots", () => {
  beforeEach(async () => { await env.DB.prepare("DELETE FROM gcal_busy").run(); });

  it("removes a slot overlapped by a Google event", async () => {
    const before = await availableSlots(env, DATE);
    expect(before.length).toBeGreaterThan(0);
    const target = before[0];

    await addBusy(target, new Date(Date.parse(target) + 3600_000).toISOString());
    const after = await availableSlots(env, DATE);
    expect(after).not.toContain(target);
    expect(after.length).toBe(before.length - 1);
  });

  it("applies the travel buffer around Google events, not just jobs", async () => {
    const before = await availableSlots(env, DATE);
    const target = before[1];
    // A 1-minute event ending just before the slot starts still collides via
    // the 30-minute buffer applied to each side.
    const evEnd = new Date(Date.parse(target) - 60_000).toISOString();
    const evStart = new Date(Date.parse(evEnd) - 60_000).toISOString();
    await addBusy(evStart, evEnd);

    expect(await availableSlots(env, DATE)).not.toContain(target);
  });

  it("an all-day busy span clears every slot that day", async () => {
    await addBusy(`${DATE}T05:00:00.000Z`, "2027-02-02T05:00:00.000Z", { allDay: true });
    expect(await availableSlots(env, DATE)).toEqual([]);
  });

  it("a multi-day busy span clears every day it covers", async () => {
    await addBusy(`${DATE}T05:00:00.000Z`, "2027-02-04T05:00:00.000Z", { allDay: true });
    expect(await availableSlots(env, DATE)).toEqual([]);
    expect(await availableSlots(env, "2027-02-02")).toEqual([]);
    expect(await availableSlots(env, "2027-02-03")).toEqual([]);
  });

  it("a CRM manual block behaves like any other busy time", async () => {
    const target = (await availableSlots(env, DATE))[0];
    await addBusy(target, new Date(Date.parse(target) + 3600_000).toISOString(), { isBlock: true });
    expect(await availableSlots(env, DATE)).not.toContain(target);
  });

  it("slotIsFree and availableSlots agree on the same fixture", async () => {
    const target = (await availableSlots(env, DATE))[0];
    expect(await slotIsFree(env, target)).toBe(true);

    await addBusy(target, new Date(Date.parse(target) + 3600_000).toISOString());
    expect(await slotIsFree(env, target)).toBe(false);
    expect(await availableSlots(env, DATE)).not.toContain(target);
  });

  it("fails open — an empty cache still returns job-derived slots", async () => {
    expect((await availableSlots(env, DATE)).length).toBeGreaterThan(0);
  });
});
