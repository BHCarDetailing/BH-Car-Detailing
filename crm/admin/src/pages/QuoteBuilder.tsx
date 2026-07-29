import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { Button, Input, Textarea } from "../components/ui";
import { useToast } from "../components/Toast";

/**
 * In-person quote builder.
 *
 * Built to be held in one hand next to a customer's car: one question per
 * screen, big targets, single-choice steps advance themselves, and the whole
 * thing autosaves so a locked phone never costs a quote.
 *
 * Step 6 hands the phone over — it covers the CRM entirely so the customer sees
 * a form, not somebody's admin panel, and taps their own consent boxes.
 */

interface Service {
  id: string;
  name: string;
  description: string | null;
  size_pricing: Record<string, number>;
  base_price_cents: number;
  area: string | null;
  level: string | null;
  duration_min: number | null;
  is_addon: boolean;
  active: boolean;
}

interface VehicleTypeOption { value: string; label: string; bucket: string; note?: string }

type Step = "vehicle" | "area" | "level" | "services" | "summary" | "customer" | "deposit" | "done";

const STEP_ORDER: Step[] = ["vehicle", "area", "level", "services", "summary", "customer", "deposit", "done"];

const AREA_OPTIONS = [
  { value: "interior", label: "Interior", hint: "Inside only" },
  { value: "exterior", label: "Exterior", hint: "Outside only" },
  { value: "both", label: "Interior + Exterior", hint: "The full car" },
];

const LEVEL_LABELS: Record<string, { label: string; hint: string }> = {
  maintenance: { label: "Maintenance Wash", hint: "Upkeep between details" },
  light: { label: "Light Detail", hint: "Refresh, lighter touch" },
  full: { label: "Full Detail", hint: "The deep one" },
  specialty: { label: "Specialty", hint: "Correction, ceramic, curb rash" },
};

const MANUAL_METHODS = [
  { value: "cash", label: "Cash" },
  { value: "zelle", label: "Zelle" },
  { value: "tap_to_pay", label: "Tap to Pay" },
  { value: "venmo", label: "Venmo" },
  { value: "other", label: "Other" },
];

const DRAFT_KEY = "bh-quote-builder-draft";

const money = (cents: number) => `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;

function duration(mins: number): string {
  if (!mins) return "—";
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h ? `${h}h${m ? ` ${m}m` : ""}` : `${m}m`;
}

/** Mirrors the server's pricing: explicit size price, else the base price. */
function priceFor(svc: Service, bucket: string): number {
  const p = svc.size_pricing?.[bucket];
  return Number.isFinite(p) && p > 0 ? Math.round(p) : Math.max(0, Math.round(svc.base_price_cents));
}

interface Draft {
  step: Step;
  vehicleType: string;
  vehicleNotes: string;
  area: string;
  level: string;
  primaryId: string;
  addonIds: string[];
  overrideDollars: string;
  customer: Record<string, string>;
  smsOptIn: boolean;
  marketingOptIn: boolean;
  jobId?: string;
  contactId?: string;
}

const BLANK: Draft = {
  step: "vehicle", vehicleType: "", vehicleNotes: "", area: "", level: "",
  primaryId: "", addonIds: [], overrideDollars: "",
  customer: { first_name: "", last_name: "", phone: "", email: "", address: "", city: "", state: "FL", zip: "", scheduled_at: "", notes: "" },
  smsOptIn: false, marketingOptIn: false,
};

/** Big tappable choice card — the whole wizard is built from these. */
function ChoiceCard({ label, hint, selected, onClick }: {
  label: string; hint?: string; selected?: boolean; onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`min-h-[84px] w-full rounded-2xl border-2 px-5 py-4 text-left transition active:scale-[0.98] ${
        selected
          ? "border-red-500 bg-red-50 ring-2 ring-red-100"
          : "border-neutral-200 bg-white hover:border-neutral-300"
      }`}
    >
      <div className="text-lg font-semibold text-neutral-900">{label}</div>
      {hint && <div className="mt-0.5 text-sm text-neutral-500">{hint}</div>}
    </button>
  );
}

export default function QuoteBuilder() {
  const [services, setServices] = useState<Service[]>([]);
  const [vehicleTypes, setVehicleTypes] = useState<VehicleTypeOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [d, setD] = useState<Draft>(BLANK);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ job_id: string; contact_id: string; total_cents: number; deposit_cents: number; duration_min: number; status: string } | null>(null);
  const [quote, setQuote] = useState<{ token: string; payments_enabled: boolean; amount_paid_cents: number } | null>(null);
  const [depositDollars, setDepositDollars] = useState("");
  const [paidCents, setPaidCents] = useState(0);
  const toast = useToast();
  const navigate = useNavigate();

  // --- load catalog + restore any half-finished quote ---
  useEffect(() => {
    Promise.all([
      api<{ items: Service[] }>("/api/services?active=1"),
      api<{ vehicle_types: VehicleTypeOption[] }>("/api/services/vocab"),
    ])
      .then(([s, v]) => { setServices(s.items); setVehicleTypes(v.vehicle_types); })
      .catch(() => toast({ message: "Could not load the service menu.", tone: "error" }))
      .finally(() => setLoading(false));

    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as Draft;
        // Never resume onto a terminal screen — that quote is finished.
        if (saved.step !== "done") setD({ ...BLANK, ...saved });
      }
    } catch { /* a corrupt draft is not worth blocking on */ }
  }, [toast]);

  useEffect(() => {
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify(d)); } catch { /* private mode */ }
  }, [d]);

  const set = useCallback((patch: Partial<Draft>) => setD((prev) => ({ ...prev, ...patch })), []);
  const go = useCallback((step: Step) => setD((prev) => ({ ...prev, step })), []);

  const vt = vehicleTypes.find((v) => v.value === d.vehicleType) ?? null;
  const bucket = vt?.bucket ?? "other";

  // --- what this vehicle + area + level can actually be sold ---
  const primaries = useMemo(
    () => services.filter((s) => !s.is_addon && s.active && priceFor(s, bucket) > 0),
    [services, bucket]
  );

  const levelsAvailable = useMemo(() => {
    const inArea = primaries.filter((s) => !d.area || s.area === d.area || s.area === "specialty");
    const seen = new Set(inArea.map((s) => s.level ?? "specialty"));
    return ["maintenance", "light", "full", "specialty"].filter((l) => seen.has(l));
  }, [primaries, d.area]);

  const matching = useMemo(
    () => primaries.filter((s) =>
      (!d.area || s.area === d.area || s.area === "specialty") &&
      (!d.level || s.level === d.level)),
    [primaries, d.area, d.level]
  );

  // An add-on with no price is a gap in the menu, not a freebie — hide it.
  const addons = useMemo(
    () => services.filter((s) => s.is_addon && s.active && priceFor(s, bucket) > 0),
    [services, bucket]
  );

  const primary = services.find((s) => s.id === d.primaryId) ?? null;
  const chosenAddons = addons.filter((a) => d.addonIds.includes(a.id));

  const computed = useMemo(() => {
    let total = primary ? priceFor(primary, bucket) : 0;
    let mins = primary?.duration_min ?? 0;
    for (const a of chosenAddons) { total += priceFor(a, bucket); mins += a.duration_min ?? 0; }
    return { total, mins };
  }, [primary, chosenAddons, bucket]);

  const overrideCents = Math.round(Number(d.overrideDollars) * 100);
  const finalTotal = d.overrideDollars.trim() && Number.isFinite(overrideCents) && overrideCents > 0
    ? overrideCents : computed.total;

  // --- submit: creates contact, vehicle, job, consent in one call ---
  async function submitQuote() {
    if (!primary) return;
    const cust = d.customer;
    if (!cust.phone.trim() && !cust.email.trim()) {
      toast({ message: "A phone or email is required.", tone: "error" });
      return;
    }
    setBusy(true);
    try {
      const res = await api<{ job_id: string; contact_id: string; total_cents: number; deposit_cents: number; duration_min: number; status: string }>(
        "/api/quote-builder/complete",
        {
          method: "POST",
          body: JSON.stringify({
            vehicle_type: d.vehicleType,
            vehicle_notes: d.vehicleNotes,
            lines: [{ service_id: primary.id, qty: 1 }, ...chosenAddons.map((a) => ({ service_id: a.id, qty: 1 }))],
            price_override_cents: d.overrideDollars.trim() ? overrideCents : undefined,
            ...cust,
            scheduled_start: cust.scheduled_at ? new Date(cust.scheduled_at).toISOString() : undefined,
            sms_opt_in: d.smsOptIn,
            marketing_opt_in: d.marketingOptIn,
          }),
        }
      );
      setResult(res);
      setDepositDollars(res.deposit_cents ? (res.deposit_cents / 100).toFixed(0) : "");
      set({ jobId: res.job_id, contactId: res.contact_id });

      // Mint the public quote link so the Stripe path is available too. The
      // booking is already saved, so a failure here costs nothing.
      try {
        const tok = await api<{ token: string }>(`/api/jobs/${res.job_id}/send-quote`, { method: "POST" });
        const pub = await fetch(`/api/quote/${tok.token}`).then((r) => r.json()) as {
          payments_enabled: boolean; amount_paid_cents: number;
        };
        setQuote({ token: tok.token, payments_enabled: pub.payments_enabled, amount_paid_cents: pub.amount_paid_cents });
      } catch { /* manual deposit still works without a quote link */ }
      go("deposit");
    } catch {
      toast({ message: "Could not save the quote. Nothing was charged.", tone: "error" });
    } finally { setBusy(false); }
  }

  const depositCents = Math.round(Number(depositDollars) * 100);

  async function takeManualDeposit(method: string) {
    if (!result) return;
    if (!Number.isFinite(depositCents) || depositCents <= 0) {
      toast({ message: "Enter how much you collected.", tone: "error" });
      return;
    }
    setBusy(true);
    try {
      await api(`/api/jobs/${result.job_id}/mark-paid`, {
        method: "POST",
        body: JSON.stringify({ amount_cents: depositCents, method }),
      });
      setPaidCents(depositCents);
      toast({ message: `${money(depositCents)} recorded as ${method.replace(/_/g, " ")}.`, tone: "success" });
      go("done");
    } catch {
      toast({ message: "Could not record the deposit.", tone: "error" });
    } finally { setBusy(false); }
  }

  async function payWithStripe() {
    if (!quote) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/quote/${quote.token}/checkout`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "deposit" }),
      });
      const body = await res.json() as { url?: string; error?: string };
      if (!body.url) throw new Error(body.error ?? "no_url");
      // The booking is already saved; this hands off to Stripe's own receipt page.
      window.location.href = body.url;
    } catch {
      toast({ message: "Stripe checkout unavailable. Take the deposit another way.", tone: "error" });
      setBusy(false);
    }
  }

  function startOver() {
    localStorage.removeItem(DRAFT_KEY);
    setD(BLANK); setResult(null); setQuote(null);
  }

  const stepIndex = STEP_ORDER.indexOf(d.step);
  const back = () => go(STEP_ORDER[Math.max(0, stepIndex - 1)]);

  if (loading) {
    return <div className="p-8 text-sm text-neutral-400">Loading the menu…</div>;
  }

  // ---------- Step 6: the handoff. Covers the CRM completely. ----------
  if (d.step === "customer") {
    const cust = d.customer;
    const setCust = (k: string, v: string) => set({ customer: { ...cust, [k]: v } });
    return (
      <div className="fixed inset-0 z-[100] overflow-y-auto bg-white">
        <div className="mx-auto max-w-lg px-5 py-8 pb-32">
          <h1 className="text-2xl font-bold text-neutral-900">Your details</h1>
          <p className="mt-1 text-sm text-neutral-500">
            {primary?.name}{vt ? ` · ${vt.label}` : ""} · {money(finalTotal)}
          </p>

          <div className="mt-6 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Input placeholder="First name" value={cust.first_name} onChange={(e) => setCust("first_name", e.target.value)} autoComplete="given-name" />
              <Input placeholder="Last name" value={cust.last_name} onChange={(e) => setCust("last_name", e.target.value)} autoComplete="family-name" />
            </div>
            <Input placeholder="Phone" type="tel" inputMode="tel" value={cust.phone} onChange={(e) => setCust("phone", e.target.value)} autoComplete="tel" />
            <Input placeholder="Email" type="email" inputMode="email" value={cust.email} onChange={(e) => setCust("email", e.target.value)} autoComplete="email" />
            <Input placeholder="Street address" value={cust.address} onChange={(e) => setCust("address", e.target.value)} autoComplete="street-address" />
            <div className="grid grid-cols-3 gap-3">
              <Input placeholder="City" value={cust.city} onChange={(e) => setCust("city", e.target.value)} autoComplete="address-level2" />
              <Input placeholder="State" value={cust.state} onChange={(e) => setCust("state", e.target.value)} autoComplete="address-level1" />
              <Input placeholder="ZIP" inputMode="numeric" value={cust.zip} onChange={(e) => setCust("zip", e.target.value)} autoComplete="postal-code" />
            </div>
            <label className="block text-sm font-medium text-neutral-700">When works for you?</label>
            <Input type="datetime-local" value={cust.scheduled_at} onChange={(e) => setCust("scheduled_at", e.target.value)} />
            <Textarea placeholder="Anything we should know? (pet hair, problem spots, gate code…)" value={cust.notes} onChange={(e) => setCust("notes", e.target.value)} />
          </div>

          {/* Consent, tapped by the customer themselves — that is the point of
              handing the phone over, and it is what carriers want to see. */}
          <div className="mt-6 space-y-3 rounded-xl bg-neutral-50 p-4">
            <label className="flex items-start gap-3 text-sm text-neutral-700">
              <input type="checkbox" checked={d.smsOptIn} onChange={(e) => set({ smsOptIn: e.target.checked })} className="mt-0.5 h-5 w-5 shrink-0 accent-red-600" />
              <span>Text me about my quote and appointment (service messages).</span>
            </label>
            <label className="flex items-start gap-3 text-sm text-neutral-700">
              <input type="checkbox" checked={d.marketingOptIn} onChange={(e) => set({ marketingOptIn: e.target.checked })} className="mt-0.5 h-5 w-5 shrink-0 accent-red-600" />
              <span>Also send me occasional offers &amp; promotions (optional).</span>
            </label>
            <p className="text-[11px] leading-relaxed text-neutral-400">
              By checking the box(es) above you agree to receive the selected texts from BH Car Detailing.
              Checking a box is optional and not a condition of purchase. Msg &amp; data rates may apply,
              frequency varies, reply STOP to opt out, HELP for help.
            </p>
          </div>
        </div>

        <div className="fixed inset-x-0 bottom-0 border-t border-neutral-200 bg-white/95 p-4 backdrop-blur">
          <div className="mx-auto flex max-w-lg gap-3">
            <Button variant="ghost" onClick={back}>Back</Button>
            <button
              onClick={submitQuote}
              disabled={busy || (!cust.phone.trim() && !cust.email.trim())}
              className="min-h-[52px] flex-1 rounded-xl bg-red-600 text-base font-semibold text-white disabled:opacity-40"
            >
              {busy ? "Saving…" : "Confirm booking"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg p-4 pb-28 md:p-8">
      {/* progress */}
      <div className="mb-5 flex items-center gap-2">
        {STEP_ORDER.slice(0, 5).map((s, i) => (
          <div key={s} className={`h-1.5 flex-1 rounded-full ${i <= Math.min(stepIndex, 4) ? "bg-red-500" : "bg-neutral-200"}`} />
        ))}
      </div>

      {d.step === "vehicle" && (
        <>
          <h1 className="mb-1 text-2xl font-bold text-neutral-900">What are we detailing?</h1>
          <p className="mb-5 text-sm text-neutral-500">Tap the closest match.</p>
          <div className="grid grid-cols-2 gap-3">
            {vehicleTypes.map((v) => (
              <ChoiceCard key={v.value} label={v.label} hint={v.note}
                selected={d.vehicleType === v.value}
                onClick={() => { set({ vehicleType: v.value, primaryId: "", addonIds: [] }); go("area"); }} />
            ))}
          </div>
        </>
      )}

      {d.step === "area" && (
        <>
          <h1 className="mb-1 text-2xl font-bold text-neutral-900">Inside, outside, or both?</h1>
          <p className="mb-5 text-sm text-neutral-500">{vt?.label} · priced as {bucket}</p>
          <div className="space-y-3">
            {AREA_OPTIONS.map((a) => (
              <ChoiceCard key={a.value} label={a.label} hint={a.hint} selected={d.area === a.value}
                onClick={() => { set({ area: a.value, level: "", primaryId: "" }); go("level"); }} />
            ))}
          </div>
        </>
      )}

      {d.step === "level" && (
        <>
          <h1 className="mb-1 text-2xl font-bold text-neutral-900">How deep are we going?</h1>
          <p className="mb-5 text-sm text-neutral-500">Only what's available for this vehicle.</p>
          <div className="space-y-3">
            {levelsAvailable.map((l) => (
              <ChoiceCard key={l} label={LEVEL_LABELS[l]?.label ?? l} hint={LEVEL_LABELS[l]?.hint}
                selected={d.level === l}
                onClick={() => { set({ level: l, primaryId: "" }); go("services"); }} />
            ))}
          </div>
        </>
      )}

      {d.step === "services" && (
        <>
          <h1 className="mb-1 text-2xl font-bold text-neutral-900">Pick the service</h1>
          <p className="mb-5 text-sm text-neutral-500">Prices shown for {vt?.label}{vt?.note ? ` — ${vt.note}` : ""}.</p>
          {matching.length === 0 ? (
            <p className="rounded-xl bg-amber-50 p-4 text-sm text-amber-800">
              Nothing on the menu matches that combination. Go back and try another service level.
            </p>
          ) : (
            <div className="space-y-3">
              {matching.map((s) => (
                <button key={s.id} type="button" onClick={() => set({ primaryId: s.id })}
                  className={`w-full rounded-2xl border-2 p-4 text-left transition active:scale-[0.99] ${
                    d.primaryId === s.id ? "border-red-500 bg-red-50 ring-2 ring-red-100" : "border-neutral-200 bg-white"}`}>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-lg font-semibold text-neutral-900">{s.name}</span>
                    <span className="shrink-0 text-lg font-bold text-neutral-900">{money(priceFor(s, bucket))}</span>
                  </div>
                  {s.description && <p className="mt-1 text-sm text-neutral-500">{s.description}</p>}
                  <p className="mt-1 text-xs text-neutral-400">about {duration(s.duration_min ?? 0)}</p>
                </button>
              ))}
            </div>
          )}

          {addons.length > 0 && (
            <>
              <h2 className="mb-2 mt-7 text-sm font-semibold uppercase tracking-wide text-neutral-500">Add-ons</h2>
              <div className="space-y-2">
                {addons.map((a) => {
                  const on = d.addonIds.includes(a.id);
                  return (
                    <button key={a.id} type="button"
                      onClick={() => set({ addonIds: on ? d.addonIds.filter((x) => x !== a.id) : [...d.addonIds, a.id] })}
                      className={`flex w-full items-center gap-3 rounded-xl border-2 p-3 text-left ${
                        on ? "border-red-500 bg-red-50" : "border-neutral-200 bg-white"}`}>
                      <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md border-2 ${
                        on ? "border-red-500 bg-red-500 text-white" : "border-neutral-300"}`}>{on ? "✓" : ""}</span>
                      <span className="flex-1 text-sm font-medium text-neutral-800">{a.name}</span>
                      <span className="text-sm font-semibold text-neutral-900">+{money(priceFor(a, bucket))}</span>
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </>
      )}

      {d.step === "summary" && primary && (
        <>
          <h1 className="mb-5 text-2xl font-bold text-neutral-900">Quote</h1>
          <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-neutral-100">
            <div className="mb-3 text-sm text-neutral-500">
              {vt?.label}{vt?.note ? ` — ${vt.note}` : ""}{d.vehicleNotes ? ` · ${d.vehicleNotes}` : ""}
            </div>
            <div className="flex justify-between py-1.5 text-sm">
              <span className="text-neutral-700">{primary.name}</span>
              <span className="font-medium">{money(priceFor(primary, bucket))}</span>
            </div>
            {chosenAddons.map((a) => (
              <div key={a.id} className="flex justify-between py-1.5 text-sm">
                <span className="text-neutral-500">+ {a.name}</span>
                <span className="text-neutral-600">{money(priceFor(a, bucket))}</span>
              </div>
            ))}
            <div className="mt-3 flex items-baseline justify-between border-t border-neutral-100 pt-3">
              <span className="font-semibold text-neutral-900">Total</span>
              <span className="text-2xl font-bold text-neutral-900">{money(finalTotal)}</span>
            </div>
            <p className="mt-1 text-xs text-neutral-400">Estimated {duration(computed.mins)} on site</p>
          </div>

          <div className="mt-4">
            <label className="mb-1 block text-xs font-medium text-neutral-600">Override the price (optional)</label>
            <Input inputMode="decimal" placeholder={`${(computed.total / 100).toFixed(0)}`}
              value={d.overrideDollars} onChange={(e) => set({ overrideDollars: e.target.value })} />
            <label className="mb-1 mt-3 block text-xs font-medium text-neutral-600">Vehicle note (optional)</label>
            <Input placeholder="e.g. Black Range Rover, curb rash 2 rims"
              value={d.vehicleNotes} onChange={(e) => set({ vehicleNotes: e.target.value })} />
          </div>
        </>
      )}

      {d.step === "deposit" && result && (
        <>
          <h1 className="mb-1 text-2xl font-bold text-neutral-900">Deposit</h1>
          <p className="mb-4 text-sm text-neutral-500">
            {result.status === "scheduled" ? "Booked" : "Quoted"} · {money(result.total_cents)} total
          </p>

          <label className="mb-1 block text-xs font-medium text-neutral-600">Deposit amount</label>
          <div className="mb-5 flex items-center gap-2">
            <span className="text-lg text-neutral-400">$</span>
            <Input inputMode="decimal" value={depositDollars} onChange={(e) => setDepositDollars(e.target.value)}
              placeholder={(result.deposit_cents / 100).toFixed(0)} />
          </div>

          {quote?.payments_enabled && (
            <button onClick={payWithStripe} disabled={busy}
              className="mb-5 min-h-[60px] w-full rounded-2xl bg-neutral-900 text-base font-semibold text-white disabled:opacity-50">
              Pay deposit with card (Stripe)
            </button>
          )}

          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">Or mark it received</h2>
          <p className="mb-3 text-xs text-neutral-400">
            These record that money arrived. Nothing verifies them automatically — only tick one if you have the money.
          </p>
          <div className="grid grid-cols-2 gap-3">
            {MANUAL_METHODS.map((m) => (
              <button key={m.value} onClick={() => takeManualDeposit(m.value)} disabled={busy}
                className="min-h-[60px] rounded-2xl border-2 border-neutral-200 bg-white text-base font-semibold text-neutral-800 active:scale-[0.98] disabled:opacity-50">
                {m.label}
              </button>
            ))}
          </div>

          <button onClick={() => go("done")} className="mt-6 w-full text-sm text-neutral-500 underline">
            Skip — collect the deposit later
          </button>
        </>
      )}

      {d.step === "done" && result && (
        <div className="py-10 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 text-3xl">✓</div>
          <h1 className="text-2xl font-bold text-neutral-900">
            {result.status === "scheduled" ? "Booked in" : "Quote saved"}
          </h1>
          <p className="mt-2 text-sm text-neutral-500">
            {money(result.total_cents)} total
            {paidCents > 0
              ? ` · ${money(paidCents)} deposit paid · ${money(Math.max(0, result.total_cents - paidCents))} due on the day`
              : " · deposit still to collect"}
          </p>
          <p className="mt-1 text-xs text-neutral-400">Confirmation {result.job_id.slice(0, 8).toUpperCase()}</p>

          <div className="mt-8 space-y-3">
            <Button onClick={() => { startOver(); }}>Create another quote</Button>
            <button onClick={() => navigate(`/contacts/${result.contact_id}`)} className="block w-full text-sm text-neutral-500 underline">
              Open the customer
            </button>
            <button onClick={() => { startOver(); navigate("/home"); }} className="block w-full text-sm text-neutral-400 underline">
              Back to home
            </button>
          </div>
        </div>
      )}

      {/* sticky footer: live total + advance */}
      {["area", "level", "services", "summary"].includes(d.step) && (
        <div className="fixed inset-x-0 bottom-0 border-t border-neutral-200 bg-white/95 p-4 backdrop-blur md:left-64">
          <div className="mx-auto flex max-w-lg items-center gap-3">
            <Button variant="ghost" onClick={back}>Back</Button>
            <div className="flex-1 text-right">
              <div className="text-xs text-neutral-400">{primary ? duration(computed.mins) : "—"}</div>
              <div className="text-lg font-bold text-neutral-900">{money(finalTotal)}</div>
            </div>
            <button
              onClick={() => go(d.step === "summary" ? "customer" : "summary")}
              disabled={!primary}
              className="min-h-[52px] flex-1 rounded-xl bg-red-600 text-base font-semibold text-white disabled:opacity-40"
            >
              {d.step === "summary" ? "Hand to customer" : "Continue"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
