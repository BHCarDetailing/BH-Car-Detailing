import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { money } from "../types";

/**
 * The customer-facing side of a QR/link handoff.
 *
 * Max picks the vehicle and service on his own phone (the quote builder's
 * "Share with customer" panel); this page is what opens when the customer
 * scans the code or taps the link — on their OWN device, so nobody has to pass
 * a phone across the driveway. The vehicle/service/price come from the server
 * record Max created, so nothing here can be tampered with from the client.
 */

interface IntentData {
  business: string;
  vehicle_label: string;
  vehicle_note: string | null;
  items: Array<{ name: string; price_cents: number; qty: number; requires_planning?: boolean }>;
  subtotal_cents: number;
  tax_cents: number;
  tax_label: string | null;
  total_cents: number;
  duration_min: number;
  requires_planning: boolean;
  completed: boolean;
  completed_status: string | null;
}

const FIELD = "min-h-[48px] w-full rounded-lg border border-neutral-300 px-3 text-base outline-none focus:border-red-400 focus:ring-2 focus:ring-red-100";

export default function Intake() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<IntentData | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "notfound">("loading");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ status: string; total_cents: number } | null>(null);
  const [error, setError] = useState("");
  const startedAt = useState(() => Date.now())[0];

  const [form, setForm] = useState({
    first_name: "", last_name: "", phone: "", email: "",
    address: "", city: "", state: "FL", zip: "", scheduled_at: "", notes: "",
    website: "", // honeypot — never shown, never filled by a real customer
  });
  const [smsOptIn, setSmsOptIn] = useState(false);
  const [marketingOptIn, setMarketingOptIn] = useState(false);

  useEffect(() => {
    fetch(`/api/intent/${token}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: IntentData) => { setData(d); setState("ok"); })
      .catch(() => setState("notfound"));
  }, [token]);

  function set(k: keyof typeof form, v: string) { setForm((f) => ({ ...f, [k]: v })); }

  async function submit() {
    if (!form.phone.trim() && !form.email.trim()) { setError("Add a phone number or email so we can reach you."); return; }
    setSubmitting(true); setError("");
    try {
      const res = await fetch(`/api/intent/${token}/complete`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form, ts: startedAt,
          scheduled_start: form.scheduled_at ? new Date(form.scheduled_at).toISOString() : undefined,
          sms_opt_in: smsOptIn, marketing_opt_in: marketingOptIn,
        }),
      });
      const body = await res.json() as { ok?: boolean; status?: string; total_cents?: number; error?: string };
      if (!res.ok || !body.ok) {
        setError(
          body.error === "already_used" ? "This link has already been used — text us and we'll send a fresh one."
          : "Couldn't submit — check your details and try again."
        );
        return;
      }
      setResult({ status: body.status ?? "quoted", total_cents: body.total_cents ?? 0 });
    } catch {
      setError("Couldn't submit — check your connection and try again.");
    } finally { setSubmitting(false); }
  }

  if (state === "loading") return <div className="safe-screen p-8 text-center text-neutral-500">Loading…</div>;
  if (state === "notfound" || !data) return (
    <div className="safe-screen mx-auto max-w-md p-8 text-center">
      <h1 className="text-xl font-semibold text-neutral-900">Link not found</h1>
      <p className="mt-2 text-neutral-500">This link is invalid or has expired. Ask for a new one.</p>
    </div>
  );

  if (data.completed || result) {
    // Prefer the outcome of THIS submission; falling back to what the server
    // recorded when the page is reloaded after the fact (e.g. a bookmark).
    const status = result?.status ?? data.completed_status ?? "quoted";
    return (
      <div className="safe-screen min-h-screen bg-neutral-100 py-10">
        <div className="mx-auto max-w-md px-4 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 text-3xl">✓</div>
          <h1 className="text-2xl font-bold text-neutral-900">
            {status === "scheduled" ? "You're booked in" : "Quote request sent"}
          </h1>
          <p className="mt-2 text-neutral-500">
            {status === "scheduled"
              ? "We'll see you then. You'll get a confirmation shortly."
              : "This one needs a quick look before we lock in a price — we'll text or call you to confirm."}
          </p>
          {!!result?.total_cents && (
            <p className="mt-4 text-lg font-semibold text-neutral-900">{money(result.total_cents)}</p>
          )}
          {data.completed && !result && (
            <p className="mt-4 text-sm text-neutral-400">This link has already been used.</p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="safe-screen min-h-screen bg-neutral-100 py-8">
      <div className="mx-auto max-w-md px-4">
        <div className="mb-4 flex items-center gap-3">
          <img src="/brand/logo.png" alt={data.business} className="h-12 w-auto" />
          <div>
            <div className="font-semibold text-neutral-900">{data.business}</div>
            <div className="text-xs text-neutral-500">{data.vehicle_label}{data.vehicle_note ? ` · ${data.vehicle_note}` : ""}</div>
          </div>
        </div>

        <div className="rounded-2xl bg-white p-6 shadow-sm">
          <h1 className="text-lg font-semibold text-neutral-900">Your quote</h1>
          <ul className="mt-3 divide-y">
            {data.items.map((it, i) => (
              <li key={i} className="flex items-center justify-between gap-3 py-2.5">
                <span className="text-sm text-neutral-800">{it.name}{it.qty > 1 ? ` ×${it.qty}` : ""}</span>
                <span className="text-sm font-medium text-neutral-900">
                  {it.price_cents > 0 ? money(it.price_cents * it.qty) : "Quote"}
                </span>
              </li>
            ))}
          </ul>
          {data.tax_cents > 0 && (
            <div className="mt-3 flex items-center justify-between border-t pt-3 text-sm">
              <span className="text-neutral-500">{data.tax_label}</span>
              <span className="text-neutral-600">{money(data.tax_cents)}</span>
            </div>
          )}
          <div className={`mt-3 flex items-center justify-between pt-3 ${data.tax_cents > 0 ? "" : "border-t"}`}>
            <span className="font-medium text-neutral-600">Total</span>
            <span className="text-2xl font-bold text-neutral-900">
              {data.total_cents > 0 ? money(data.total_cents) : "To be confirmed"}
            </span>
          </div>

          {data.requires_planning && (
            <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
              <strong>This one needs planning.</strong> Fill in your details and we'll call you to confirm the price and pick a date.
            </p>
          )}
        </div>

        <div className="mt-4 rounded-2xl bg-white p-6 shadow-sm">
          <h2 className="mb-3 text-base font-semibold text-neutral-900">Your details</h2>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <input className={FIELD} placeholder="First name" value={form.first_name} onChange={(e) => set("first_name", e.target.value)} autoComplete="given-name" />
              <input className={FIELD} placeholder="Last name" value={form.last_name} onChange={(e) => set("last_name", e.target.value)} autoComplete="family-name" />
            </div>
            <input className={FIELD} placeholder="Phone" type="tel" inputMode="tel" value={form.phone} onChange={(e) => set("phone", e.target.value)} autoComplete="tel" />
            <input className={FIELD} placeholder="Email" type="email" inputMode="email" value={form.email} onChange={(e) => set("email", e.target.value)} autoComplete="email" />
            <input className={FIELD} placeholder="Street address" value={form.address} onChange={(e) => set("address", e.target.value)} autoComplete="street-address" />
            <div className="grid grid-cols-3 gap-3">
              <input className={FIELD} placeholder="City" value={form.city} onChange={(e) => set("city", e.target.value)} autoComplete="address-level2" />
              <input className={FIELD} placeholder="State" value={form.state} onChange={(e) => set("state", e.target.value)} autoComplete="address-level1" />
              <input className={FIELD} placeholder="ZIP" inputMode="numeric" value={form.zip} onChange={(e) => set("zip", e.target.value)} autoComplete="postal-code" />
            </div>
            {!data.requires_planning && (
              <>
                <label className="block text-sm font-medium text-neutral-700">When works for you?</label>
                <input className={FIELD} type="datetime-local" value={form.scheduled_at} onChange={(e) => set("scheduled_at", e.target.value)} />
              </>
            )}
            <textarea className={FIELD + " py-2"} rows={3} placeholder="Anything we should know? (pet hair, gate code…)" value={form.notes} onChange={(e) => set("notes", e.target.value)} />
            {/* Honeypot — invisible to a real visitor, catnip for a bot. */}
            <input tabIndex={-1} autoComplete="off" value={form.website} onChange={(e) => set("website", e.target.value)}
              className="absolute -left-[9999px]" aria-hidden="true" />
          </div>

          <div className="mt-4 space-y-3 rounded-xl bg-neutral-50 p-4">
            <label className="flex items-start gap-3 text-sm text-neutral-700">
              <input type="checkbox" checked={smsOptIn} onChange={(e) => setSmsOptIn(e.target.checked)} className="mt-0.5 h-5 w-5 shrink-0 accent-red-600" />
              <span>Text me about my quote and appointment (service messages).</span>
            </label>
            <label className="flex items-start gap-3 text-sm text-neutral-700">
              <input type="checkbox" checked={marketingOptIn} onChange={(e) => setMarketingOptIn(e.target.checked)} className="mt-0.5 h-5 w-5 shrink-0 accent-red-600" />
              <span>Also send me occasional offers &amp; promotions (optional).</span>
            </label>
            <p className="text-[11px] leading-relaxed text-neutral-400">
              By checking the box(es) above you agree to receive the selected texts from {data.business}.
              Checking a box is optional and not a condition of purchase. Msg &amp; data rates may apply,
              frequency varies, reply STOP to opt out, HELP for help.
            </p>
          </div>

          {error && <p className="mt-3 text-sm text-rose-600">{error}</p>}

          <button onClick={submit} disabled={submitting}
            className="mt-4 min-h-[52px] w-full rounded-xl bg-red-600 text-base font-semibold text-white disabled:opacity-50">
            {submitting ? "Sending…" : data.requires_planning ? "Send my details" : "Confirm booking"}
          </button>
        </div>

        <p className="mt-4 text-center text-xs text-neutral-400">Questions? Just reply to the text we sent you.</p>
      </div>
    </div>
  );
}
