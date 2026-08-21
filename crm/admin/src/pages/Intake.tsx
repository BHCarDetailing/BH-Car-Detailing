import { useCallback, useEffect, useState } from "react";
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
 *
 * Times come from /api/book/availability, the same source /book uses, so what
 * a customer can pick here already respects business hours, existing jobs and
 * anything marked Busy on the Google calendar.
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

const FIELD =
  "min-h-[48px] w-full rounded-lg border border-white/10 bg-graphite-850 px-3 text-base text-steel-50 " +
  "placeholder-chrome-400 outline-none transition focus:border-red-600 focus:ring-2 focus:ring-red-600/30";

const PANEL = "rounded-2xl border border-white/10 bg-graphite-900/80 p-6 shadow-2xl backdrop-blur-xl bh-gloss";

/** Local YYYY-MM-DD. The availability API reads dates in the shop's timezone. */
const ymdLocal = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const addDays = (n: number): Date => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d;
};

const timeLabel = (iso: string): string =>
  new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <div className="eyebrow text-[10px] text-chrome-400">{children}</div>
      <div className="mt-2 h-px w-10 bg-red-600" />
    </div>
  );
}

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

  // ---- availability
  const [days] = useState(() => Array.from({ length: 14 }, (_, i) => addDays(i)));
  const [activeDay, setActiveDay] = useState(() => ymdLocal(new Date()));
  const [slots, setSlots] = useState<string[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [firstLoadDone, setFirstLoadDone] = useState(false);

  useEffect(() => {
    fetch(`/api/intent/${token}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: IntentData) => { setData(d); setState("ok"); })
      .catch(() => setState("notfound"));
  }, [token]);

  const fetchSlots = useCallback(async (dayKey: string): Promise<string[]> => {
    const r = await fetch(`/api/book/availability?date=${dayKey}`)
      .then((res) => res.json() as Promise<{ slots?: string[] }>)
      .catch(() => ({ slots: [] as string[] }));
    return r.slots ?? [];
  }, []);

  // Opening on a day with nothing free reads as "they're never available", so
  // walk forward to the first day that has something and land there instead.
  useEffect(() => {
    if (!data || data.requires_planning || firstLoadDone) return;
    let cancelled = false;
    (async () => {
      setSlotsLoading(true);
      for (let i = 0; i < 10; i++) {
        const key = ymdLocal(addDays(i));
        const found = await fetchSlots(key);
        if (cancelled) return;
        if (found.length) { setActiveDay(key); setSlots(found); break; }
      }
      if (!cancelled) { setSlotsLoading(false); setFirstLoadDone(true); }
    })();
    return () => { cancelled = true; };
  }, [data, firstLoadDone, fetchSlots]);

  async function pickDay(key: string) {
    setActiveDay(key);
    setForm((f) => ({ ...f, scheduled_at: "" }));
    setSlotsLoading(true);
    const found = await fetchSlots(key);
    setSlots(found);
    setSlotsLoading(false);
  }

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
          // Single unified consent box only -- no separate marketing opt-in.
          sms_opt_in: smsOptIn, marketing_opt_in: false,
        }),
      });
      const body = await res.json() as { ok?: boolean; status?: string; total_cents?: number; error?: string };
      if (!res.ok || !body.ok) {
        if (body.error === "slot_taken") {
          // Someone booked it while this form was open. Reload the day so the
          // times on screen are true before they pick again.
          setForm((f) => ({ ...f, scheduled_at: "" }));
          setSlots(await fetchSlots(activeDay));
          setError("That time was just booked. Pick another below.");
          return;
        }
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

  if (state === "loading") {
    return <div className="bh-bg safe-screen min-h-screen p-8 text-center text-chrome-400">Loading…</div>;
  }

  if (state === "notfound" || !data) return (
    <div className="bh-bg safe-screen min-h-screen py-16">
      <div className="relative z-10 mx-auto max-w-md px-4 text-center">
        <h1 className="font-display text-2xl text-white">Link not found</h1>
        <p className="mt-2 text-chrome-400">This link is invalid or has expired. Ask us for a new one.</p>
      </div>
    </div>
  );

  if (data.completed || result) {
    // Prefer the outcome of THIS submission; falling back to what the server
    // recorded when the page is reloaded after the fact (e.g. a bookmark).
    const status = result?.status ?? data.completed_status ?? "quoted";
    return (
      <div className="bh-bg safe-screen min-h-screen py-16">
        <div className="relative z-10 mx-auto max-w-md px-4 text-center">
          <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full border border-red-600/40 bg-red-600/10 text-3xl text-red-500">✓</div>
          <h1 className="font-display text-3xl text-white">
            {status === "scheduled" ? "You're booked in" : "Quote request sent"}
          </h1>
          <p className="mt-3 text-chrome-400">
            {status === "scheduled"
              ? "We'll see you then. A confirmation text is on its way."
              : "This one needs a quick look before we lock in a price — we'll text or call you to confirm."}
          </p>
          {!!result?.total_cents && (
            <p className="mt-6 font-display text-4xl text-white">{money(result.total_cents)}</p>
          )}
          {data.completed && !result && (
            <p className="mt-4 text-sm text-chrome-400">This link has already been used.</p>
          )}
        </div>
      </div>
    );
  }

  const ctaLabel = data.requires_planning || !form.scheduled_at ? "Send my details" : "Confirm booking";

  return (
    <div className="bh-bg safe-screen min-h-screen py-8">
      <div className="relative z-10 mx-auto max-w-md space-y-4 px-4">

        <header className="flex items-center gap-3 pb-1">
          <img src="/brand/logo.png" alt={data.business} className="h-12 w-auto" />
          <div>
            <div className="font-display text-lg leading-tight text-white">{data.business}</div>
            <div className="eyebrow text-[10px] text-chrome-400">
              {data.vehicle_label}{data.vehicle_note ? ` · ${data.vehicle_note}` : ""}
            </div>
          </div>
        </header>

        {/* ---- The quote: the reason they opened this link, so it leads. ---- */}
        <section className={PANEL}>
          <Eyebrow>Your quote</Eyebrow>
          <ul className="divide-y divide-white/5">
            {data.items.map((it, i) => (
              <li key={i} className="flex items-center justify-between gap-3 py-2.5">
                <span className="text-sm text-steel-200">{it.name}{it.qty > 1 ? ` ×${it.qty}` : ""}</span>
                <span className="font-display text-sm text-white">
                  {it.price_cents > 0 ? money(it.price_cents * it.qty) : "Quote"}
                </span>
              </li>
            ))}
          </ul>
          {data.tax_cents > 0 && (
            <div className="flex items-center justify-between border-t border-white/5 pt-3 text-sm">
              <span className="text-chrome-400">{data.tax_label}</span>
              <span className="text-steel-200">{money(data.tax_cents)}</span>
            </div>
          )}
          <div className="mt-4 flex items-end justify-between border-t border-white/10 pt-4">
            <span className="eyebrow text-[10px] text-chrome-400">Total</span>
            <span className="font-display text-4xl leading-none text-white">
              {data.total_cents > 0 ? money(data.total_cents) : "TBC"}
            </span>
          </div>

          {data.requires_planning && (
            <p className="mt-4 rounded-lg border border-red-600/30 bg-red-600/10 px-3 py-2.5 text-sm text-red-100">
              <strong className="font-semibold">This one needs planning.</strong> Leave your details and we'll call to confirm the price and pick a date.
            </p>
          )}
        </section>

        {/* ---- Time. Only real openings; the chip mirrors the one Max sees. ---- */}
        {!data.requires_planning && (
          <section className={PANEL}>
            <Eyebrow>Pick your time</Eyebrow>
            <p className="-mt-2 mb-4 text-sm text-chrome-400">
              Two-hour arrival window. We come to you.
            </p>

            <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-2">
              {days.map((d) => {
                const key = ymdLocal(d);
                const on = key === activeDay;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => pickDay(key)}
                    aria-pressed={on}
                    className={`shrink-0 rounded-lg border px-3 py-2 text-center transition focus:outline-none focus-visible:ring-2 focus-visible:ring-red-600/50 ${
                      on ? "border-red-600 bg-red-600/15" : "border-white/10 bg-graphite-850 hover:border-white/20"
                    }`}
                  >
                    <div className={`text-[10px] uppercase tracking-wide ${on ? "text-red-400" : "text-chrome-400"}`}>
                      {d.toLocaleDateString([], { weekday: "short" })}
                    </div>
                    <div className={`font-display text-lg leading-none ${on ? "text-white" : "text-steel-200"}`}>
                      {d.getDate()}
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="mt-4 space-y-2">
              {slotsLoading && <p className="text-sm text-chrome-400">Finding open times…</p>}
              {!slotsLoading && slots.length === 0 && (
                <p className="text-sm text-chrome-400">Nothing open that day. Try another above.</p>
              )}
              {!slotsLoading && slots.map((s) => {
                const on = form.scheduled_at === s;
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => set("scheduled_at", s)}
                    aria-pressed={on}
                    className={`flex w-full items-center justify-between rounded-lg border border-l-[3px] px-3 py-3 text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-red-600/50 ${
                      on
                        ? "border-white/10 border-l-red-600 bg-red-600/15"
                        : "border-white/10 border-l-white/10 bg-graphite-850 hover:border-l-red-600/50"
                    }`}
                  >
                    <span className={`font-display text-base ${on ? "text-white" : "text-steel-200"}`}>{timeLabel(s)}</span>
                    <span className="text-xs text-chrome-400">{on ? "Selected" : "Open"}</span>
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {/* ---- Details ---- */}
        <section className={PANEL}>
          <Eyebrow>Your details</Eyebrow>
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
            <textarea className={FIELD + " py-2"} rows={3} placeholder="Anything we should know? (pet hair, gate code…)" value={form.notes} onChange={(e) => set("notes", e.target.value)} />
            {/* Honeypot — invisible to a real visitor, catnip for a bot. */}
            <input tabIndex={-1} autoComplete="off" value={form.website} onChange={(e) => set("website", e.target.value)}
              className="absolute -left-[9999px]" aria-hidden="true" />
          </div>

          {/* One checkbox, one line, wording identical everywhere a phone number
              is collected -- the site forms, /book, this page and the quote builder. */}
          <div className="mt-4 rounded-xl border border-white/5 bg-graphite-850/60 p-4">
            <label className="flex items-start gap-3 text-sm text-steel-200">
              <input type="checkbox" checked={smsOptIn} onChange={(e) => setSmsOptIn(e.target.checked)} className="mt-0.5 h-5 w-5 shrink-0 accent-red-600" />
              <span>
                Yes, text me about my quote and appointment updates from BH Car Detailing. Msg &amp; data
                rates may apply. Msg frequency varies. Reply STOP to opt out anytime.{" "}
                <a href="https://bhcardetails.com/terms.html" target="_blank" rel="noreferrer" className="underline hover:text-white">Terms</a>
                {" · "}
                <a href="https://bhcardetails.com/privacy-policy.html" target="_blank" rel="noreferrer" className="underline hover:text-white">Privacy</a>
              </span>
            </label>
          </div>

          {error && <p className="mt-3 text-sm text-red-400">{error}</p>}

          <button onClick={submit} disabled={submitting}
            className="mt-4 min-h-[52px] w-full rounded-xl bg-red-600 font-display text-base tracking-wide text-white transition hover:bg-red-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-600/50 disabled:opacity-50">
            {submitting ? "Sending…" : ctaLabel}
          </button>
        </section>

        <p className="pt-2 text-center text-xs text-chrome-400">Questions? Just reply to the text we sent you.</p>
      </div>
    </div>
  );
}
