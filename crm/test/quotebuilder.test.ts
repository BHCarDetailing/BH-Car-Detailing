import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { all, nowIso, one, run, uuid } from "../src/lib/db";
import { bucketFor, priceFor, vehicleType, VEHICLE_TYPES } from "../src/lib/vehicles";
import { priceLines } from "../src/routes/quotebuilder";

const AUTH = { Authorization: "Bearer dev-agent-key", "Content-Type": "application/json" };

describe("vehicle types", () => {
  it("offers the customer-facing types and maps each to a price bucket", () => {
    expect(VEHICLE_TYPES).toHaveLength(10);
    expect(bucketFor("large_suv")).toBe("suv");
    expect(bucketFor("coupe")).toBe("sedan");
    expect(bucketFor("hatchback")).toBe("sedan");
    expect(bucketFor("pickup")).toBe("truck");
    expect(bucketFor("oversized")).toBe("truck");
    expect(bucketFor("exotic")).toBe("exotic");
  });

  it("falls back to the widest tier for an unknown type", () => {
    expect(bucketFor("spaceship")).toBe("other");
    expect(vehicleType("spaceship")).toBeNull();
  });

  it("shows a note wherever the billing tier differs from the label", () => {
    expect(VEHICLE_TYPES.find((v) => v.value === "large_suv")?.note).toBeTruthy();
    expect(VEHICLE_TYPES.find((v) => v.value === "sedan")?.note).toBeUndefined();
  });
});

describe("priceFor", () => {
  it("uses the size price when present", () => {
    expect(priceFor({ sedan: 25000, suv: 32500 }, "suv", 25000)).toBe(32500);
  });

  it("falls back to base price rather than quoting free", () => {
    expect(priceFor({ sedan: 25000 }, "van", 25000)).toBe(25000);
    expect(priceFor({}, "exotic", 18000)).toBe(18000);
    expect(priceFor({ exotic: 0 }, "exotic", 18000)).toBe(18000);
  });
});

describe("priceLines", () => {
  const services = [
    { id: "full", name: "Full Detail", base_price_cents: 25000, size_pricing: '{"sedan":25000,"suv":32500,"exotic":32500}', duration_min: 240, is_addon: 0 },
    { id: "pet", name: "Pet Hair", base_price_cents: 5000, size_pricing: '{"sedan":5000,"suv":6000}', duration_min: 45, is_addon: 1 },
    { id: "unpriced", name: "Odor Removal", base_price_cents: 0, size_pricing: "{}", duration_min: 45, is_addon: 1 },
  ];

  it("prices a service plus add-on for the vehicle's bucket and totals the duration", () => {
    const r = priceLines(services, [{ service_id: "full", qty: 1 }, { service_id: "pet", qty: 1 }], "large_suv");
    expect(r.bucket).toBe("suv");
    expect(r.total_cents).toBe(32500 + 6000);
    expect(r.duration_min).toBe(285);
    expect(r.items).toHaveLength(2);
    expect(r.items[1].is_addon).toBe(true);
  });

  it("writes price_cents per unit, the key the shareable quote page reads", () => {
    const r = priceLines(services, [{ service_id: "full", qty: 2 }], "sedan");
    expect(r.items[0].price_cents).toBe(25000);   // per unit, not the line total
    expect(r.items[0].qty).toBe(2);
    expect(r.total_cents).toBe(50000);
  });

  it("never sells an unpriced add-on as free", () => {
    const r = priceLines(services, [{ service_id: "full", qty: 1 }, { service_id: "unpriced", qty: 1 }], "sedan");
    expect(r.items).toHaveLength(1);
    expect(r.total_cents).toBe(25000);
  });

  it("multiplies quantity — two rims of curb rash", () => {
    const r = priceLines(services, [{ service_id: "full", qty: 2 }], "sedan");
    expect(r.total_cents).toBe(50000);
  });

  it("ignores a service id that is not on the menu", () => {
    const r = priceLines(services, [{ service_id: "ghost", qty: 1 }], "sedan");
    expect(r.items).toHaveLength(0);
  });
});

describe("service taxonomy migration", () => {
  it("classifies the live menu and fixes exotic pricing below SUV", async () => {
    const rows = await all<{ name: string; area: string; level: string; duration_min: number; size_pricing: string }>(
      env.DB, "SELECT name, area, level, duration_min, size_pricing FROM services WHERE is_addon = 0");
    expect(rows.length).toBeGreaterThan(0);

    for (const r of rows) {
      expect(r.area).toBeTruthy();
      expect(r.level).toBeTruthy();
      expect(r.duration_min).toBeGreaterThan(0);
      const p = JSON.parse(r.size_pricing || "{}") as Record<string, number>;
      // The whole point of the correction: an exotic never costs less than an SUV.
      if (p.exotic && p.suv) expect(p.exotic).toBeGreaterThanOrEqual(p.suv);
    }
  });

  it("seeds add-ons unpriced so they cannot be sold by accident", async () => {
    const addons = await all<{ name: string; base_price_cents: number }>(
      env.DB, "SELECT name, base_price_cents FROM services WHERE is_addon = 1");
    expect(addons.length).toBeGreaterThanOrEqual(7);
    expect(addons.map((a) => a.name)).toContain("Pet Hair Removal");
  });

  it("exposes the vocabulary the wizard needs", async () => {
    const r = await SELF.fetch("http://x/api/services/vocab", { headers: AUTH });
    const body = (await r.json()) as { vehicle_types: unknown[]; areas: string[]; levels: string[] };
    expect(body.vehicle_types).toHaveLength(10);
    expect(body.areas).toContain("interior");
    expect(body.levels).toContain("maintenance");
  });

  it("filters the catalogue to add-ons or primaries", async () => {
    const primaries = (await (await SELF.fetch("http://x/api/services?addons=0", { headers: AUTH })).json()) as { items: { is_addon: boolean }[] };
    expect(primaries.items.every((i) => !i.is_addon)).toBe(true);
    const addons = (await (await SELF.fetch("http://x/api/services?addons=1", { headers: AUTH })).json()) as { items: { is_addon: boolean }[] };
    expect(addons.items.every((i) => i.is_addon)).toBe(true);
  });
});

describe("POST /api/quote-builder/complete", () => {
  const base = {
    vehicle_type: "mid_suv",
    first_name: "Nina", last_name: "Ortiz",
    address: "12 Ocean Dr", city: "Miami", state: "FL", zip: "33139",
  };

  async function firstServiceId(): Promise<string> {
    const r = await one<{ id: string }>(env.DB, "SELECT id FROM services WHERE is_addon = 0 AND active = 1 ORDER BY sort LIMIT 1");
    return r!.id;
  }

  it("creates contact, vehicle and a scheduled job in one call", async () => {
    const svc = await firstServiceId();
    const start = new Date(Date.now() + 3 * 86_400_000).toISOString();
    const res = await SELF.fetch("http://x/api/quote-builder/complete", {
      method: "POST", headers: AUTH,
      body: JSON.stringify({ ...base, phone: "+13055557001", service_ids: [svc], scheduled_start: start, sms_opt_in: true }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { contact_id: string; job_id: string; total_cents: number; status: string };
    expect(body.status).toBe("scheduled");
    expect(body.total_cents).toBeGreaterThan(0);

    const contact = await one<{ stage: string; zip: string; state: string; sms_opt_in: number }>(
      env.DB, "SELECT stage, zip, state, sms_opt_in FROM contacts WHERE id = ?", body.contact_id);
    expect(contact?.stage).toBe("scheduled");
    expect(contact?.zip).toBe("33139");
    expect(contact?.sms_opt_in).toBe(1);

    const job = await one<{ status: string; scheduled_start: string; vehicle_id: string; address: string }>(
      env.DB, "SELECT status, scheduled_start, vehicle_id, address FROM jobs WHERE id = ?", body.job_id);
    expect(job?.status).toBe("scheduled");
    expect(job?.scheduled_start).toBe(start);
    expect(job?.vehicle_id).toBeTruthy();
    expect(job?.address).toContain("Miami");

    const vehicle = await one<{ size_class: string }>(env.DB, "SELECT size_class FROM vehicles WHERE id = ?", job!.vehicle_id);
    expect(vehicle?.size_class).toBe("suv");   // mid_suv bills as suv
  });

  it("leaves the job quoted when no time was picked", async () => {
    const svc = await firstServiceId();
    const res = await SELF.fetch("http://x/api/quote-builder/complete", {
      method: "POST", headers: AUTH,
      body: JSON.stringify({ ...base, phone: "+13055557002", service_ids: [svc] }),
    });
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe("quoted");
  });

  it("reuses an existing contact instead of creating a duplicate", async () => {
    const svc = await firstServiceId();
    const phone = "+13055557003";
    const first = await SELF.fetch("http://x/api/quote-builder/complete", {
      method: "POST", headers: AUTH, body: JSON.stringify({ ...base, phone, service_ids: [svc] }),
    });
    const a = (await first.json()) as { contact_id: string; created_contact: boolean };
    expect(a.created_contact).toBe(true);

    const second = await SELF.fetch("http://x/api/quote-builder/complete", {
      method: "POST", headers: AUTH, body: JSON.stringify({ ...base, phone, service_ids: [svc] }),
    });
    const b = (await second.json()) as { contact_id: string; created_contact: boolean };
    expect(b.created_contact).toBe(false);
    expect(b.contact_id).toBe(a.contact_id);

    const n = await one<{ n: number }>(env.DB, "SELECT COUNT(*) AS n FROM contacts WHERE phone = ?", phone);
    expect(n?.n).toBe(1);
  });

  it("honours a price override", async () => {
    const svc = await firstServiceId();
    const res = await SELF.fetch("http://x/api/quote-builder/complete", {
      method: "POST", headers: AUTH,
      body: JSON.stringify({ ...base, phone: "+13055557004", service_ids: [svc], price_override_cents: 19900 }),
    });
    const body = (await res.json()) as { total_cents: number };
    expect(body.total_cents).toBe(19900);
  });

  it("records marketing consent separately from service consent", async () => {
    const svc = await firstServiceId();
    const res = await SELF.fetch("http://x/api/quote-builder/complete", {
      method: "POST", headers: AUTH,
      body: JSON.stringify({ ...base, phone: "+13055557005", service_ids: [svc], sms_opt_in: true, marketing_opt_in: true }),
    });
    const { contact_id } = (await res.json()) as { contact_id: string };
    const c = await one<{ tags: string }>(env.DB, "SELECT tags FROM contacts WHERE id = ?", contact_id);
    expect(c?.tags).toContain("sms_marketing");

    const act = await all<{ title: string }>(
      env.DB, "SELECT title FROM activities WHERE contact_id = ? AND title LIKE '%consent%'", contact_id);
    expect(act.length).toBeGreaterThan(0);
  });

  it("rejects a request with no contact details, no vehicle, or no service", async () => {
    const svc = await firstServiceId();
    const noContact = await SELF.fetch("http://x/api/quote-builder/complete", {
      method: "POST", headers: AUTH, body: JSON.stringify({ vehicle_type: "sedan", service_ids: [svc] }) });
    expect(noContact.status).toBe(400);

    const noVehicle = await SELF.fetch("http://x/api/quote-builder/complete", {
      method: "POST", headers: AUTH, body: JSON.stringify({ phone: "+13055557006", service_ids: [svc] }) });
    expect(noVehicle.status).toBe(400);

    const noService = await SELF.fetch("http://x/api/quote-builder/complete", {
      method: "POST", headers: AUTH, body: JSON.stringify({ ...base, phone: "+13055557007", service_ids: [] }) });
    expect(noService.status).toBe(400);
  });

  it("booking in person exits any sequence the customer was in", async () => {
    const svc = await firstServiceId();
    const seqId = uuid();
    const now = nowIso();
    await run(env.DB, "INSERT INTO sequences (id, name, status, trigger, priority, created_at, updated_at) VALUES (?,?, 'active', 'manual', 50, ?, ?)", seqId, "Nurture", now, now);
    await run(env.DB, "INSERT INTO sequence_steps (id, sequence_id, step_order, delay_hours, subject, body_text, channel, created_at) VALUES (?,?,0,0,?,?, 'email', ?)", uuid(), seqId, "Hi", "hello", now);

    const cid = uuid();
    await run(env.DB, "INSERT INTO contacts (id, first_name, phone, email, stage, created_at, updated_at) VALUES (?,?,?,?, 'new', ?, ?)",
      cid, "Enrolled", "+13055557008", "enrolled@x.com", now, now);
    await SELF.fetch(`http://x/api/sequences/${seqId}/enroll`, { method: "POST", headers: AUTH, body: JSON.stringify({ contact_id: cid }) });

    await SELF.fetch("http://x/api/quote-builder/complete", {
      method: "POST", headers: AUTH,
      body: JSON.stringify({ ...base, phone: "+13055557008", service_ids: [svc], scheduled_start: new Date(Date.now() + 86_400_000).toISOString() }),
    });

    const e = await one<{ status: string; exit_reason: string }>(
      env.DB, "SELECT status, exit_reason FROM enrollments WHERE contact_id = ?", cid);
    expect(e?.status).toBe("exited");
    expect(e?.exit_reason).toBe("booked");
  });

  it("accepts the manual deposit methods the wizard offers", async () => {
    const svc = await firstServiceId();
    const res = await SELF.fetch("http://x/api/quote-builder/complete", {
      method: "POST", headers: AUTH,
      body: JSON.stringify({ ...base, phone: "+13055557009", service_ids: [svc] }),
    });
    const { job_id } = (await res.json()) as { job_id: string };

    for (const method of ["cash", "zelle", "tap_to_pay", "venmo", "other"]) {
      const paid = await SELF.fetch(`http://x/api/jobs/${job_id}/mark-paid`, {
        method: "POST", headers: AUTH, body: JSON.stringify({ amount_cents: 1000, method }),
      });
      expect(paid.status).toBe(200);
    }
    const job = await one<{ amount_paid_cents: number }>(env.DB, "SELECT amount_paid_cents FROM jobs WHERE id = ?", job_id);
    expect(job?.amount_paid_cents).toBe(5000);
  });
});

describe("solo maintenance pricing", () => {
  it("prices the solos at 60% exterior / 65% interior of the maintenance wash, to the nearest $5", async () => {
    const wash = await one<{ size_pricing: string }>(
      env.DB, "SELECT size_pricing FROM services WHERE level = 'maintenance' AND area = 'exterior' AND id NOT LIKE 'svc_maint_%' LIMIT 1");
    const ext = await one<{ size_pricing: string }>(env.DB, "SELECT size_pricing FROM services WHERE id = 'svc_maint_ext'");
    const int = await one<{ size_pricing: string }>(env.DB, "SELECT size_pricing FROM services WHERE id = 'svc_maint_int'");
    expect(ext).toBeTruthy();
    expect(int).toBeTruthy();

    const e = JSON.parse(ext!.size_pricing) as Record<string, number>;
    const i = JSON.parse(int!.size_pricing) as Record<string, number>;

    // Approved figures: sedan $70/$75, everything larger $85/$90.
    expect(e.sedan).toBe(7000);
    expect(i.sedan).toBe(7500);
    for (const size of ["suv", "truck", "van", "exotic"]) {
      expect(e[size]).toBe(8500);
      expect(i[size]).toBe(9000);
    }

    // Every price lands on a round $5, and the pair costs more than the bundle.
    for (const v of [...Object.values(e), ...Object.values(i)]) expect(v % 500).toBe(0);
    if (wash) {
      const w = JSON.parse(wash.size_pricing) as Record<string, number>;
      expect(e.sedan + i.sedan).toBeGreaterThan(w.sedan);
    }
  });

  it("sells each solo on its own for every vehicle size", () => {
    const rows = [
      { id: "svc_maint_ext", name: "Solo Exterior Maintenance", base_price_cents: 7000, size_pricing: '{"sedan":7000,"suv":8500,"truck":8500,"van":8500,"exotic":8500}', duration_min: 40, is_addon: 0 },
    ];
    for (const [type, expected] of [["sedan", 7000], ["coupe", 7000], ["large_suv", 8500], ["pickup", 8500], ["exotic", 8500]] as const) {
      const r = priceLines(rows, [{ service_id: "svc_maint_ext", qty: 1 }], type);
      expect(r.total_cents).toBe(expected);
    }
  });
});

describe("specialty work that has to be planned", () => {
  const base = { vehicle_type: "sedan", first_name: "Planner", phone: "+13055559101" };

  it("quotes planned work at zero rather than skipping it", () => {
    const rows = [
      { id: "svc_ppf", name: "PPF", base_price_cents: 0, size_pricing: "{}", duration_min: 480, is_addon: 0, requires_planning: 1 },
      { id: "svc_unpriced_addon", name: "Odor", base_price_cents: 0, size_pricing: "{}", duration_min: 45, is_addon: 1 },
    ];
    const r = priceLines(rows, [{ service_id: "svc_ppf", qty: 1 }, { service_id: "svc_unpriced_addon", qty: 1 }], "sedan");
    expect(r.items).toHaveLength(1);          // the unpriced add-on is still skipped
    expect(r.items[0].service_id).toBe("svc_ppf");
    expect(r.needsPlanning).toBe(true);
    expect(r.total_cents).toBe(0);
  });

  it("refuses to put planned work on the calendar, even if a time is sent", async () => {
    const res = await SELF.fetch("http://x/api/quote-builder/complete", {
      method: "POST", headers: AUTH,
      body: JSON.stringify({
        ...base, service_ids: ["svc_ppf"],
        scheduled_start: new Date(Date.now() + 86_400_000).toISOString(),
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { status: string; requires_planning: boolean; job_id: string };
    expect(body.requires_planning).toBe(true);
    expect(body.status).toBe("quoted");

    const job = await one<{ status: string; scheduled_start: string | null }>(
      env.DB, "SELECT status, scheduled_start FROM jobs WHERE id = ?", body.job_id);
    expect(job?.status).toBe("quoted");
    expect(job?.scheduled_start).toBeNull();
  });

  it("still books same-day specialty work like curb rash", async () => {
    const curb = await one<{ id: string }>(env.DB, "SELECT id FROM services WHERE lower(name) LIKE '%curb%' LIMIT 1");
    if (!curb) return;
    const start = new Date(Date.now() + 86_400_000).toISOString();
    const res = await SELF.fetch("http://x/api/quote-builder/complete", {
      method: "POST", headers: AUTH,
      body: JSON.stringify({ ...base, phone: "+13055559102", service_ids: [curb.id], scheduled_start: start }),
    });
    const body = (await res.json()) as { status: string; requires_planning: boolean };
    expect(body.requires_planning).toBe(false);
    expect(body.status).toBe("scheduled");
  });

  it("marks ceramic, PPF, wrap and correction as planned, and the quick jobs as not", async () => {
    const rows = await all<{ name: string; requires_planning: number }>(
      env.DB, "SELECT name, requires_planning FROM services");
    const find = (needle: string) => rows.find((r) => r.name.toLowerCase().includes(needle));
    for (const needle of ["ceramic", "ppf", "wrap", "correction"]) {
      expect(find(needle)?.requires_planning).toBe(1);
    }
    for (const needle of ["curb", "headlight", "scratch"]) {
      const row = find(needle);
      if (row) expect(row.requires_planning).toBe(0);
    }
  });
});
