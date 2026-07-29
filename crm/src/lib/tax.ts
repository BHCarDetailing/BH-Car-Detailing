/**
 * Sales tax.
 *
 * Off by default — Florida does not tax most detailing labour, so charging it
 * by accident is worse than not offering it at all. When it is on, tax is
 * folded into the job's price_cents and also recorded separately in tax_cents,
 * so every existing money path (deposit, balance, revenue) keeps working on the
 * amount the customer actually pays, while the books can still see the split.
 */
import type { Env } from "../types";
import { all } from "./db";

export interface TaxSettings {
  enabled: boolean;
  /** Percent, e.g. 7 means 7%. */
  rate: number;
  label: string;
}

export const TAX_DEFAULTS: TaxSettings = { enabled: false, rate: 0, label: "Sales tax" };

export async function loadTaxSettings(env: Env): Promise<TaxSettings> {
  const rows = await all<{ key: string; value: string }>(
    env.DB, "SELECT key, value FROM settings WHERE key IN ('tax_enabled','tax_rate','tax_label')");
  const map = new Map(rows.map((r) => [r.key, r.value]));
  const rate = Number(map.get("tax_rate"));
  return {
    enabled: map.get("tax_enabled") === "1",
    rate: Number.isFinite(rate) && rate > 0 ? Math.min(rate, 100) : 0,
    label: (map.get("tax_label") || "").trim() || TAX_DEFAULTS.label,
  };
}

/**
 * Tax on a subtotal, in cents. Rounded half-up, and zero whenever tax is off or
 * the rate is unset — a misconfigured rate must never silently inflate a quote.
 */
export function taxOn(subtotalCents: number, tax: TaxSettings): number {
  if (!tax.enabled || tax.rate <= 0 || subtotalCents <= 0) return 0;
  return Math.round((subtotalCents * tax.rate) / 100);
}
