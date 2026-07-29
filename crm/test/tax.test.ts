import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { one, run } from "../src/lib/db";
import { loadTaxSettings, taxOn, TAX_DEFAULTS } from "../src/lib/tax";

const AUTH = { Authorization: "Bearer dev-agent-key", "Content-Type": "application/json" };

const setTax = async (enabled: boolean, rate: string, label = "Sales tax") => {
  for (const [k, v] of [["tax_enabled", enabled ? "1" : "0"], ["tax_rate", rate], ["tax_label", label]]) {
    await run(env.DB, "INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", k, v);
  }
};

async function firstServiceId(): Promise<string> {
  const r = await one<{ id: string }>(env.DB, "SELECT id FROM services WHERE is_addon = 0 AND active = 1 ORDER BY sort LIMIT 1");
  return r!.id;
}

describe("taxOn", () => {
  const on = { enabled: true, rate: 7, label: "Sales tax" };

  it("applies the rate and rounds to the nearest cent", () => {
    expect(taxOn(10000, on)).toBe(700);
    expect(taxOn(22500, on)).toBe(1575);
    expect(taxOn(19999, on)).toBe(1400);   // 1399.93 → 1400
  });

  it("charges nothing when tax is switched off", () => {
    expect(taxOn(10000, { ...on, enabled: false })).toBe(0);
  });

  it("charges nothing when the rate is missing or zero", () => {
    expect(taxOn(10000, { ...on, rate: 0 })).toBe(0);
    expect(taxOn(10000, TAX_DEFAULTS)).toBe(0);
  });

  it("never taxes a zero or negative subtotal", () => {
    expect(taxOn(0, on)).toBe(0);
    expect(taxOn(-500, on)).toBe(0);
  });
});

describe("loadTaxSettings", () => {
  it("is off by default and clamps a nonsense rate", async () => {
    await setTax(false, "0");
    expect((await loadTaxSettings(env)).enabled).toBe(false);

    await setTax(true, "999");
    expect((await loadTaxSettings(env)).rate).toBe(100);

    await setTax(true, "not-a-number");
    expect((await loadTaxSettings(env)).rate).toBe(0);
  });

  it("falls back to a sensible label", async () => {
    await setTax(true, "7", "   ");
    expect((await loadTaxSettings(env)).label).toBe("Sales tax");
  });
});

describe("tax in the quote builder", () => {
  const base = { vehicle_type: "sedan", first_name: "Taxy", address: "1 Main St", city: "Miami", state: "FL", zip: "33139" };

  it("adds tax on top and records the split on the job", async () => {
    await setTax(true, "7", "FL sales tax");
    const svc = await firstServiceId();
    const res = await SELF.fetch("http://x/api/quote-builder/complete", {
      method: "POST", headers: AUTH,
      body: JSON.stringify({ ...base, phone: "+13055558001", service_ids: [svc], price_override_cents: 20000 }),
    });
    const body = (await res.json()) as { subtotal_cents: number; tax_cents: number; total_cents: number; job_id: string; tax_label: string };
    expect(body.subtotal_cents).toBe(20000);
    expect(body.tax_cents).toBe(1400);
    expect(body.total_cents).toBe(21400);
    expect(body.tax_label).toBe("FL sales tax");

    // price_cents is what the customer pays, so deposits and balances stay correct.
    const job = await one<{ price_cents: number; tax_cents: number }>(
      env.DB, "SELECT price_cents, tax_cents FROM jobs WHERE id = ?", body.job_id);
    expect(job?.price_cents).toBe(21400);
    expect(job?.tax_cents).toBe(1400);
  });

  it("charges no tax when it is switched off", async () => {
    await setTax(false, "7");
    const svc = await firstServiceId();
    const res = await SELF.fetch("http://x/api/quote-builder/complete", {
      method: "POST", headers: AUTH,
      body: JSON.stringify({ ...base, phone: "+13055558002", service_ids: [svc], price_override_cents: 20000 }),
    });
    const body = (await res.json()) as { tax_cents: number; total_cents: number };
    expect(body.tax_cents).toBe(0);
    expect(body.total_cents).toBe(20000);
  });

  it("bases the deposit on the taxed total", async () => {
    await setTax(true, "10");
    const svc = await firstServiceId();
    const res = await SELF.fetch("http://x/api/quote-builder/complete", {
      method: "POST", headers: AUTH,
      body: JSON.stringify({ ...base, phone: "+13055558003", service_ids: [svc], price_override_cents: 10000 }),
    });
    const body = (await res.json()) as { total_cents: number; deposit_cents: number };
    expect(body.total_cents).toBe(11000);
    expect(body.deposit_cents).toBe(Math.round(11000 * 0.25));
    await setTax(false, "7");
  });

  it("reports the configuration the wizard renders from", async () => {
    await setTax(true, "6.5", "Tax");
    const cfg = (await (await SELF.fetch("http://x/api/quote-builder/config", { headers: AUTH })).json()) as
      { tax_enabled: boolean; tax_rate: number; tax_label: string; deposit_percent: number };
    expect(cfg.tax_enabled).toBe(true);
    expect(cfg.tax_rate).toBe(6.5);
    expect(cfg.tax_label).toBe("Tax");
    expect(cfg.deposit_percent).toBeGreaterThan(0);
    await setTax(false, "7");
  });

  it("shows the split on the public quote page", async () => {
    await setTax(true, "7");
    const svc = await firstServiceId();
    const made = await SELF.fetch("http://x/api/quote-builder/complete", {
      method: "POST", headers: AUTH,
      body: JSON.stringify({ ...base, phone: "+13055558004", service_ids: [svc], price_override_cents: 30000 }),
    });
    const { job_id } = (await made.json()) as { job_id: string };
    const { token } = (await (await SELF.fetch(`http://x/api/jobs/${job_id}/send-quote`, { method: "POST", headers: AUTH })).json()) as { token: string };

    const pub = (await (await SELF.fetch(`http://x/api/quote/${token}`)).json()) as
      { subtotal_cents: number; tax_cents: number; tax_label: string | null; total_cents: number };
    expect(pub.subtotal_cents).toBe(30000);
    expect(pub.tax_cents).toBe(2100);
    expect(pub.total_cents).toBe(32100);
    expect(pub.tax_label).toBe("Sales tax");
    await setTax(false, "7");
  });

  it("hides the tax line on an untaxed quote", async () => {
    await setTax(false, "7");
    const svc = await firstServiceId();
    const made = await SELF.fetch("http://x/api/quote-builder/complete", {
      method: "POST", headers: AUTH,
      body: JSON.stringify({ ...base, phone: "+13055558005", service_ids: [svc] }),
    });
    const { job_id } = (await made.json()) as { job_id: string };
    const { token } = (await (await SELF.fetch(`http://x/api/jobs/${job_id}/send-quote`, { method: "POST", headers: AUTH })).json()) as { token: string };
    const pub = (await (await SELF.fetch(`http://x/api/quote/${token}`)).json()) as { tax_cents: number; tax_label: string | null };
    expect(pub.tax_cents).toBe(0);
    expect(pub.tax_label).toBeNull();
  });
});

describe("settings round-trip", () => {
  it("saves and reads back the tax keys", async () => {
    for (const [key, value] of [["tax_enabled", "1"], ["tax_rate", "8.25"], ["tax_label", "County tax"]]) {
      const r = await SELF.fetch("http://x/api/settings", { method: "PUT", headers: AUTH, body: JSON.stringify({ key, value }) });
      expect(r.status).toBe(200);
    }
    const t = await loadTaxSettings(env);
    expect(t).toEqual({ enabled: true, rate: 8.25, label: "County tax" });
    await setTax(false, "7");
  });
});
