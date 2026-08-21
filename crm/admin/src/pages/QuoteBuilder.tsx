import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import QRCode from "qrcode";
import { api } from "../api";
import { Button, Input, Textarea } from "../components/ui";
import { useToast } from "../components/Toast";
import "./quotebuilder.css";

/** Local YYYY-MM-DD `n` days out. Availability is read in the shop's timezone. */
function qbDay(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

async function qbOpenings(dayKey: string): Promise<string[]> {
  const r = await fetch(`/api/book/availability?date=${dayKey}`)
    .then((res) => res.json() as Promise<{ slots?: string[] }>)
    .catch(() => ({ slots: [] as string[] }));
  return r.slots ?? [];
}

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
  /** Sellable on its own, as opposed to only alongside another service. */
  standalone?: boolean;
  /** Needs product ordered and a day set aside — quoted, never booked on the spot. */
  requires_planning?: boolean;
  active: boolean;
}

interface VehicleTypeOption { value: string; label: string; bucket: string; note?: string }
interface TaxConfig { tax_enabled: boolean; tax_rate: number; tax_label: string }

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
/** A recovered draft older than this belongs to a different conversation. */
const DRAFT_MAX_AGE_MS = 60 * 60 * 1000;

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
  jobId?: string;
  contactId?: string;
}

const BLANK: Draft = {
  step: "vehicle", vehicleType: "", vehicleNotes: "", area: "", level: "",
  primaryId: "", addonIds: [], overrideDollars: "",
  customer: { first_name: "", last_name: "", phone: "", email: "", address: "", city: "", state: "FL", zip: "", scheduled_at: "", notes: "" },
  smsOptIn: false,
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
          ? "border-red-500 bg-[#c8102e] qb-sel ring-2 ring-[rgba(200,16,46,0.35)]"
          : "border-steel-200 bg-white hover:border-chrome-300"
      }`}
    >
      <div className="text-lg font-semibold text-graphite-900">{label}</div>
      {hint && <div className="mt-0.5 text-sm text-chrome-500">{hint}</div>}
    </button>
  );
}

export default function QuoteBuilder() {
  const [services, setServices] = useState<Service[]>([]);
  const [vehicleTypes, setVehicleTypes] = useState<VehicleTypeOption[]>([]);
  const [taxCfg, setTaxCfg] = useState<TaxConfig>({ tax_enabled: false, tax_rate: 0, tax_label: "Sales tax" });
  const [loading, setLoading] = useState(true);
  const [d, setD] = useState<Draft>(BLANK);
  // Real availability, same source /book and the intake link use.
  const [qbDate, setQbDate] = useState(() => qbDay(0));
  const [qbSlots, setQbSlots] = useState<string[]>([]);
  const [qbSlotsLoading, setQbSlotsLoading] = useState(false);
  const [qbRailReady, setQbRailReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ job_id: string; contact_id: string; total_cents: number; deposit_cents: number; duration_min: number; status: string } | null>(null);
  // Share-with-customer: a QR code and a link that opens the same quote on the
  // customer's OWN phone, so nobody has to hand a device across the driveway.
  const [shareToken, setShareToken] = useState<string | null>(null);
  const [shareBusy, setShareBusy] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);
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
      api<TaxConfig>("/api/quote-builder/config").catch(() => null),
    ])
      .then(([s, v, cfg]) => {
        setServices(s.items); setVehicleTypes(v.vehicle_types);
        if (cfg) setTaxCfg(cfg);
      })
      .catch(() => toast({ message: "Could not load the service menu.", tone: "error" }))
      .finally(() => setLoading(false));

    // A draft only exists to survive the phone locking mid-quote. It is not a
    // saved document: leaving the wizard clears it, and anything left behind by
    // a crash goes stale quickly so the next customer never starts inside the
    // last one's quote.
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as Draft & { savedAt?: number };
        const age = Date.now() - (saved.savedAt ?? 0);
        if (saved.step !== "done" && age < DRAFT_MAX_AGE_MS) setD({ ...BLANK, ...saved });
        else localStorage.removeItem(DRAFT_KEY);
      }
    } catch { localStorage.removeItem(DRAFT_KEY); }
  }, [toast]);

  useEffect(() => {
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ ...d, savedAt: Date.now() })); } catch { /* private mode */ }
  }, [d]);

  // Leaving the wizard — by the header close, a tab, or the browser — starts the
  // next quote clean. Without this, walking up to a new customer resumed the
  // previous one's vehicle and services.
  useEffect(() => () => { try { localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ } }, []);

  const set = useCallback((patch: Partial<Draft>) => setD((prev) => ({ ...prev, ...patch })), []);
  const go = useCallback((step: Step) => setD((prev) => ({ ...prev, step })), []);

  const vt = vehicleTypes.find((v) => v.value === d.vehicleType) ?? null;
  const bucket = vt?.bucket ?? "other";

  // --- what this vehicle + area + level can actually be sold ---
  /**
   * Services sellable on their own for this vehicle.
   *
   * Planned work (ceramic, PPF, wrap, correction) is deliberately included with
   * no price: it is quoted after seeing the car, and hiding it would mean the
   * customer standing there never hears it is on offer.
   */
  const primaries = useMemo(
    () => services.filter((s) =>
      (s.standalone ?? !s.is_addon) && s.active &&
      // Specialty work is quoted off the damage in front of you, so it shows
      // without a menu price; anything else unpriced stays hidden.
      (priceFor(s, bucket) > 0 || s.requires_planning === true || s.level === "specialty")),
    [services, bucket]
  );

  /**
   * Every level this vehicle can be sold, regardless of the area chosen.
   *
   * Deliberately not filtered by area: a Maintenance Wash is an exterior-only
   * service, so filtering by "Interior + Exterior" used to hide it entirely and
   * the step dead-ended with no way to reach it.
   */
  const levelsAvailable = useMemo(() => {
    const seen = new Set(primaries.map((s) => s.level ?? "specialty"));
    return ["maintenance", "light", "full", "specialty"].filter((l) => seen.has(l));
  }, [primaries]);

  /**
   * Services for the chosen level. Honours the chosen area when that level
   * actually offers something there, and otherwise shows what the level does
   * offer rather than an empty screen — with the mismatch called out in the UI.
   */
  const { matching, areaRelaxed } = useMemo(() => {
    const atLevel = primaries.filter((s) => !d.level || s.level === d.level);
    const inArea = atLevel.filter((s) => !d.area || s.area === d.area || s.area === "specialty");
    if (inArea.length > 0) return { matching: inArea, areaRelaxed: false };
    return { matching: atLevel, areaRelaxed: atLevel.length > 0 };
  }, [primaries, d.area, d.level]);

  // An add-on with no price is a gap in the menu, not a freebie — hide it.
  const addons = useMemo(
    () => services.filter((s) => s.is_addon && s.active && priceFor(s, bucket) > 0),
    [services, bucket]
  );

  const primary = services.find((s) => s.id === d.primaryId) ?? null;
  const chosenAddons = addons.filter((a) => d.addonIds.includes(a.id));
  const needsPlanning = primary?.requires_planning === true;

  // Standing next to the car, the last thing you want is a picker offering a
  // time that is already gone. Walk forward to the first day with real openings.
  useEffect(() => {
    if (needsPlanning || qbRailReady) return;
    let cancelled = false;
    (async () => {
      setQbSlotsLoading(true);
      for (let i = 0; i < 10; i++) {
        const key = qbDay(i);
        const found = await qbOpenings(key);
        if (cancelled) return;
        if (found.length) { setQbDate(key); setQbSlots(found); break; }
      }
      if (!cancelled) { setQbSlotsLoading(false); setQbRailReady(true); }
    })();
    return () => { cancelled = true; };
  }, [needsPlanning, qbRailReady]);

  async function pickQbDay(key: string) {
    setQbDate(key);
    setD((prev) => ({ ...prev, customer: { ...prev.customer, scheduled_at: "" } }));
    setQbSlotsLoading(true);
    setQbSlots(await qbOpenings(key));
    setQbSlotsLoading(false);
  }

  // A share link is only valid for the exact vehicle/service/price it was
  // created from, so any of those changing invalidates the old one rather than
  // silently handing the customer a mismatched quote.
  useEffect(() => {
    setShareToken(null); setQrDataUrl(null);
  }, [d.vehicleType, d.primaryId, d.addonIds.join(","), d.overrideDollars]);

  const shareUrl = shareToken ? `${location.origin}/intake/${shareToken}` : null;

  async function createShareLink() {
    if (!primary) return;
    setShareBusy(true);
    try {
      const res = await api<{ token: string }>("/api/quote-builder/intent", {
        method: "POST",
        body: JSON.stringify({
          vehicle_type: d.vehicleType,
          vehicle_notes: d.vehicleNotes,
          lines: [{ service_id: primary.id, qty: 1 }, ...chosenAddons.map((a) => ({ service_id: a.id, qty: 1 }))],
          price_override_cents: d.overrideDollars.trim() ? overrideCents : undefined,
        }),
      });
      setShareToken(res.token);
      const url = `${location.origin}/intake/${res.token}`;
      setQrDataUrl(await QRCode.toDataURL(url, { margin: 1, width: 240 }));
    } catch {
      toast({ message: "Could not create the link.", tone: "error" });
    } finally { setShareBusy(false); }
  }

  async function copyShareLink() {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 1800);
    } catch {
      toast({ message: "Couldn't copy — long-press the link to copy it.", tone: "error" });
    }
  }

  const computed = useMemo(() => {
    let total = primary ? priceFor(primary, bucket) : 0;
    let mins = primary?.duration_min ?? 0;
    for (const a of chosenAddons) { total += priceFor(a, bucket); mins += a.duration_min ?? 0; }
    return { total, mins };
  }, [primary, chosenAddons, bucket]);

  const overrideCents = Math.round(Number(d.overrideDollars) * 100);
  // An override replaces the pre-tax subtotal, matching what the server does.
  const subtotal = d.overrideDollars.trim() && Number.isFinite(overrideCents) && overrideCents > 0
    ? overrideCents : computed.total;
  const taxCents = taxCfg.tax_enabled && taxCfg.tax_rate > 0 && subtotal > 0
    ? Math.round((subtotal * taxCfg.tax_rate) / 100) : 0;
  const finalTotal = subtotal + taxCents;

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
            // Single unified consent box only -- no separate marketing opt-in.
            marketing_opt_in: false,
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
    return <div className="p-8 text-sm text-chrome-500">Loading the menu…</div>;
  }

  // ---------- Step 6: the handoff. Covers the CRM completely. ----------
  if (d.step === "customer") {
    const cust = d.customer;
    const setCust = (k: string, v: string) => set({ customer: { ...cust, [k]: v } });
    return (
      <div className="bh-qb safe-top safe-x fixed inset-0 z-[100] overflow-y-auto">
        <div className="mx-auto max-w-lg px-5 py-8 pb-32">
          <h1 className="text-2xl font-bold text-graphite-900">Your <em className="qb-serif">details</em></h1>
          <p className="mt-1 text-sm text-chrome-500">
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
            {needsPlanning ? (
              // Asking for a time we cannot honour would be a promise broken
              // before they leave the driveway.
              <div className="rounded-xl bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
                <strong>This one needs planning.</strong> We'll confirm your quote and call you to
                book a date — nothing is scheduled today.
              </div>
            ) : (
              <>
                <label className="block text-sm font-medium text-graphite-800">When works for you?</label>
                <p className="-mt-1 text-xs text-chrome-500">
                  Only times you're actually free — business hours, booked jobs and your Google calendar.
                </p>
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {Array.from({ length: 14 }, (_, i) => qbDay(i)).map((key) => {
                    const on = key === qbDate;
                    const dd = new Date(`${key}T12:00:00`);
                    return (
                      <button key={key} type="button" aria-pressed={on} onClick={() => pickQbDay(key)}
                        className={`shrink-0 rounded-lg border px-3 py-2 text-center transition ${
                          on ? "border-red-500 bg-[#c8102e] qb-sel" : "border-steel-200 bg-white"}`}>
                        <div className="text-[10px] uppercase tracking-wide text-chrome-500">
                          {dd.toLocaleDateString([], { weekday: "short" })}
                        </div>
                        <div className="text-lg font-bold leading-none text-graphite-900">{dd.getDate()}</div>
                      </button>
                    );
                  })}
                </div>
                <div className="flex flex-wrap gap-2">
                  {qbSlotsLoading && <p className="text-sm text-chrome-500">Finding open times…</p>}
                  {!qbSlotsLoading && qbSlots.length === 0 && (
                    <p className="text-sm text-chrome-500">Nothing open that day. Try another above.</p>
                  )}
                  {!qbSlotsLoading && qbSlots.map((s) => {
                    const on = cust.scheduled_at === s;
                    return (
                      <button key={s} type="button" aria-pressed={on}
                        onClick={() => setCust("scheduled_at", s)}
                        className={`rounded-lg border px-4 py-3 text-sm font-semibold transition ${
                          on ? "border-red-500 bg-[#c8102e] qb-sel" : "border-steel-200 bg-white text-graphite-900"}`}>
                        {new Date(s).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                      </button>
                    );
                  })}
                </div>
              </>
            )}
            <Textarea placeholder="Anything we should know? (pet hair, problem spots, gate code…)" value={cust.notes} onChange={(e) => setCust("notes", e.target.value)} />
          </div>

          {/* Consent, tapped by the customer themselves — that is the point of
              handing the phone over, and it is what carriers want to see. */}
          {/* One checkbox, one line, wording identical everywhere a phone number
              is collected -- the site forms, /book, the QR intake and here. */}
          <div className="mt-6 rounded-xl bg-steel-50 p-4">
            <label className="flex items-start gap-3 text-sm text-graphite-800">
              <input type="checkbox" checked={d.smsOptIn} onChange={(e) => set({ smsOptIn: e.target.checked })} className="mt-0.5 h-5 w-5 shrink-0 accent-red-600" />
              <span>
                Yes, text me about my quote and appointment updates from BH Car Detailing. Msg &amp; data
                rates may apply. Msg frequency varies. Reply STOP to opt out anytime.{" "}
                <a href="https://bhcardetails.com/terms.html" target="_blank" rel="noreferrer" className="underline">Terms</a>
                {" · "}
                <a href="https://bhcardetails.com/privacy-policy.html" target="_blank" rel="noreferrer" className="underline">Privacy</a>
              </span>
            </label>
          </div>
        </div>

        <div className="fixed inset-x-0 bottom-0 border-t border-steel-200 bg-[rgba(8,8,9,0.94)] p-4 backdrop-blur"
          style={{ paddingBottom: "calc(1rem + env(safe-area-inset-bottom))" }}>
          <div className="mx-auto flex max-w-lg gap-3">
            <Button variant="ghost" onClick={back}>Back</Button>
            <button
              onClick={submitQuote}
              disabled={busy || (!cust.phone.trim() && !cust.email.trim())}
              className="min-h-[52px] flex-1 rounded-xl bg-red-600 text-base font-semibold text-graphite-900 disabled:opacity-40"
            >
              {busy ? "Saving…" : "Confirm booking"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bh-qb"><div className="mx-auto max-w-lg p-4 pb-28 md:p-8">
      {/* progress */}
      <div className="mb-5 flex items-center gap-2">
        {STEP_ORDER.slice(0, 5).map((s, i) => (
          <div key={s} className={`h-1.5 flex-1 rounded-full ${i <= Math.min(stepIndex, 4) ? "bg-red-500" : "bg-steel-200"}`} />
        ))}
      </div>

      {d.step === "vehicle" && (
        <>
          <h1 className="mb-1 text-2xl font-bold text-graphite-900">What are we <em className="qb-serif">detailing?</em></h1>
          <p className="mb-5 text-sm text-chrome-500">Tap the closest match.</p>
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
          <h1 className="mb-1 text-2xl font-bold text-graphite-900">Inside, outside, or <em className="qb-serif">both?</em></h1>
          <p className="mb-5 text-sm text-chrome-500">{vt?.label} · priced as {bucket}</p>
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
          <h1 className="mb-1 text-2xl font-bold text-graphite-900">How deep are we <em className="qb-serif">going?</em></h1>
          <p className="mb-5 text-sm text-chrome-500">Only what's available for this vehicle.</p>
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
          <h1 className="mb-1 text-2xl font-bold text-graphite-900">Pick the <em className="qb-serif">service</em></h1>
          <p className="mb-3 text-sm text-chrome-500">Prices shown for {vt?.label}{vt?.note ? ` — ${vt.note}` : ""}.</p>
          {areaRelaxed && (
            <p className="mb-4 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800">
              {LEVEL_LABELS[d.level]?.label ?? "This service"} isn't offered as{" "}
              {AREA_OPTIONS.find((a) => a.value === d.area)?.label.toLowerCase() ?? "that"} — here's how it comes.
            </p>
          )}
          {matching.length === 0 ? (
            <p className="rounded-xl bg-amber-50 p-4 text-sm text-amber-800">
              Nothing on the menu matches that combination. Go back and try another service level.
            </p>
          ) : (
            <div className="space-y-3">
              {matching.map((s) => (
                <button key={s.id} type="button" onClick={() => set({ primaryId: s.id })}
                  className={`w-full rounded-2xl border-2 p-4 text-left transition active:scale-[0.99] ${
                    d.primaryId === s.id ? "border-red-500 bg-[#c8102e] qb-sel ring-2 ring-[rgba(200,16,46,0.35)]" : "border-steel-200 bg-white"}`}>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-lg font-semibold text-graphite-900">{s.name}</span>
                    <span className="shrink-0 text-lg font-bold text-graphite-900">
                      {priceFor(s, bucket) > 0 ? money(priceFor(s, bucket)) : "Quote"}
                    </span>
                  </div>
                  {s.description && <p className="mt-1 text-sm text-chrome-500">{s.description}</p>}
                  <p className="mt-1 text-xs text-chrome-500">about {duration(s.duration_min ?? 0)}</p>
                  {s.requires_planning ? (
                    <p className="mt-2 rounded-lg bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800">
                      Has to be planned — we'll book a date once it's quoted, not today.
                    </p>
                  ) : priceFor(s, bucket) <= 0 ? (
                    <p className="mt-2 rounded-lg bg-steel-50 px-2.5 py-1.5 text-xs text-chrome-500">
                      Priced on the day — look it over and set the price on the next screen.
                    </p>
                  ) : null}
                </button>
              ))}
            </div>
          )}

          {addons.length > 0 && (
            <>
              <h2 className="mb-2 mt-7 text-sm font-semibold uppercase tracking-wide text-chrome-500">Add-ons</h2>
              <div className="space-y-2">
                {addons.map((a) => {
                  const on = d.addonIds.includes(a.id);
                  return (
                    <button key={a.id} type="button"
                      onClick={() => set({ addonIds: on ? d.addonIds.filter((x) => x !== a.id) : [...d.addonIds, a.id] })}
                      className={`flex w-full items-center gap-3 rounded-xl border-2 p-3 text-left ${
                        on ? "border-red-500 bg-[#c8102e] qb-sel" : "border-steel-200 bg-white"}`}>
                      <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md border-2 ${
                        on ? "border-red-500 bg-red-500 text-white" : "border-chrome-300"}`}>{on ? "✓" : ""}</span>
                      <span className="flex-1 text-sm font-medium text-graphite-900">{a.name}</span>
                      <span className="text-sm font-semibold text-graphite-900">+{money(priceFor(a, bucket))}</span>
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
          <h1 className="mb-5 text-2xl font-bold text-graphite-900">Quote</h1>
          <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-steel-200">
            <div className="mb-3 text-sm text-chrome-500">
              {vt?.label}{vt?.note ? ` — ${vt.note}` : ""}{d.vehicleNotes ? ` · ${d.vehicleNotes}` : ""}
            </div>
            <div className="flex justify-between py-1.5 text-sm">
              <span className="text-graphite-800">{primary.name}</span>
              <span className="font-medium">{money(priceFor(primary, bucket))}</span>
            </div>
            {chosenAddons.map((a) => (
              <div key={a.id} className="flex justify-between py-1.5 text-sm">
                <span className="text-chrome-500">+ {a.name}</span>
                <span className="text-graphite-800">{money(priceFor(a, bucket))}</span>
              </div>
            ))}
            {taxCents > 0 && (
              <>
                <div className="mt-3 flex justify-between border-t border-steel-100 pt-3 text-sm">
                  <span className="text-chrome-500">Subtotal</span>
                  <span className="text-graphite-800">{money(subtotal)}</span>
                </div>
                <div className="flex justify-between py-1.5 text-sm">
                  <span className="text-chrome-500">{taxCfg.tax_label} ({taxCfg.tax_rate}%)</span>
                  <span className="text-graphite-800">{money(taxCents)}</span>
                </div>
              </>
            )}
            <div className={`mt-3 flex items-baseline justify-between pt-3 ${taxCents > 0 ? "" : "border-t border-steel-100"}`}>
              <span className="font-semibold text-graphite-900">Total</span>
              <span className="qb-num text-2xl font-bold text-graphite-900">{money(finalTotal)}</span>
            </div>
            <p className="mt-1 text-xs text-chrome-500">Estimated {duration(computed.mins)} on site</p>
          </div>

          <div className="mt-4">
            <label className="mb-1 block text-xs font-medium text-graphite-800">
              {computed.total <= 0 && !needsPlanning
                ? "Set the price for this job"
                : `Override the price${taxCents > 0 ? " before tax" : ""} (optional)`}
            </label>
            <Input inputMode="decimal" placeholder={`${(computed.total / 100).toFixed(0)}`}
              value={d.overrideDollars} onChange={(e) => set({ overrideDollars: e.target.value })} />
            <label className="mb-1 mt-3 block text-xs font-medium text-graphite-800">Vehicle note (optional)</label>
            <Input placeholder="e.g. Black Range Rover, curb rash 2 rims"
              value={d.vehicleNotes} onChange={(e) => set({ vehicleNotes: e.target.value })} />
          </div>

          {/* Let the customer fill in their own details on their own phone,
              instead of handing this one across the driveway. */}
          <div className="mt-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-steel-200">
            <h2 className="text-sm font-semibold text-graphite-900">Share with the customer</h2>
            <p className="mt-1 text-xs text-chrome-500">
              They scan the code or open the link on their own phone, fill in their details, and book.
            </p>
            {!shareToken ? (
              <button onClick={createShareLink} disabled={shareBusy}
                className="mt-3 min-h-[48px] w-full rounded-xl bg-steel-100 text-sm font-semibold text-graphite-900 disabled:opacity-50">
                {shareBusy ? "Creating…" : "Create QR code & link"}
              </button>
            ) : (
              <div className="mt-3 flex flex-col items-center gap-3 sm:flex-row sm:items-start">
                {qrDataUrl && (
                  <img src={qrDataUrl} alt="QR code that opens this quote" className="h-36 w-36 shrink-0 rounded-lg ring-1 ring-steel-200" />
                )}
                <div className="w-full min-w-0 flex-1 space-y-2">
                  <div className="truncate rounded-lg bg-steel-50 px-3 py-2 text-xs text-chrome-500">{shareUrl}</div>
                  <button onClick={copyShareLink}
                    className="min-h-[44px] w-full rounded-lg bg-steel-50 text-sm font-medium text-graphite-900">
                    {linkCopied ? "Copied!" : "Copy link"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {d.step === "deposit" && result && (
        <>
          <h1 className="mb-1 text-2xl font-bold text-graphite-900">Deposit</h1>
          <p className="mb-4 text-sm text-chrome-500">
            {result.status === "scheduled" ? "Booked" : "Quoted"}
            {result.total_cents > 0 ? ` · ${money(result.total_cents)} total` : " · price to be confirmed"}
          </p>

          {needsPlanning && (
            <div className="mb-5 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">
              <strong>Saved as a quote, not a booking.</strong> This work needs planning, so follow up
              with a firm price and a date. Take a deposit only once they've agreed the price.
            </div>
          )}

          <label className="mb-1 block text-xs font-medium text-graphite-800">Deposit amount</label>
          <div className="mb-5 flex items-center gap-2">
            <span className="text-lg text-chrome-500">$</span>
            <Input inputMode="decimal" value={depositDollars} onChange={(e) => setDepositDollars(e.target.value)}
              placeholder={(result.deposit_cents / 100).toFixed(0)} />
          </div>

          {quote?.payments_enabled && (
            <button onClick={payWithStripe} disabled={busy}
              className="mb-5 min-h-[60px] w-full rounded-2xl bg-steel-100 text-base font-semibold text-graphite-900 disabled:opacity-50">
              Pay deposit with card (Stripe)
            </button>
          )}

          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-chrome-500">Or mark it received</h2>
          <p className="mb-3 text-xs text-chrome-500">
            These record that money arrived. Nothing verifies them automatically — only tick one if you have the money.
          </p>
          <div className="grid grid-cols-2 gap-3">
            {MANUAL_METHODS.map((m) => (
              <button key={m.value} onClick={() => takeManualDeposit(m.value)} disabled={busy}
                className="min-h-[60px] rounded-2xl border-2 border-steel-200 bg-white text-base font-semibold text-graphite-900 active:scale-[0.98] disabled:opacity-50">
                {m.label}
              </button>
            ))}
          </div>

          <button onClick={() => go("done")} className="mt-6 w-full text-sm text-chrome-500 underline">
            Skip — collect the deposit later
          </button>
        </>
      )}

      {d.step === "done" && result && (
        <div className="py-10 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-[rgba(16,185,129,0.16)] text-3xl">✓</div>
          <h1 className="text-2xl font-bold text-graphite-900">
            {result.status === "scheduled" ? "Booked in" : "Quote saved"}
          </h1>
          {needsPlanning && (
            <p className="mx-auto mt-2 max-w-xs text-sm text-amber-800">
              Call them back with a price and a date — this one wasn't scheduled.
            </p>
          )}
          <p className="mt-2 text-sm text-chrome-500">
            {result.total_cents > 0 ? `${money(result.total_cents)} total` : "Price to be confirmed"}
            {paidCents > 0
              ? ` · ${money(paidCents)} deposit paid · ${money(Math.max(0, result.total_cents - paidCents))} due on the day`
              : " · deposit still to collect"}
          </p>
          <p className="mt-1 text-xs text-chrome-500">Confirmation {result.job_id.slice(0, 8).toUpperCase()}</p>

          <div className="mt-8 space-y-3">
            <Button onClick={() => { startOver(); }}>Create another quote</Button>
            <button onClick={() => navigate(`/contacts/${result.contact_id}`)} className="block w-full text-sm text-chrome-500 underline">
              Open the customer
            </button>
            <button onClick={() => { startOver(); navigate("/home"); }} className="block w-full text-sm text-chrome-500 underline">
              Back to home
            </button>
          </div>
        </div>
      )}

      {/* sticky footer: live total + advance */}
      {["area", "level", "services", "summary"].includes(d.step) && (
        <div className="fixed inset-x-0 bottom-0 border-t border-steel-200 bg-[rgba(8,8,9,0.94)] p-4 backdrop-blur md:left-64"
          style={{ paddingBottom: "calc(1rem + env(safe-area-inset-bottom))" }}>
          <div className="mx-auto flex max-w-lg items-center gap-3">
            <Button variant="ghost" onClick={back}>Back</Button>
            <div className="flex-1 text-right">
              <div className="text-xs text-chrome-500">{primary ? duration(computed.mins) : "—"}</div>
              <div className="qb-num text-lg font-bold text-graphite-900">{money(finalTotal)}</div>
            </div>
            <button
              onClick={() => go(d.step === "summary" ? "customer" : "summary")}
              disabled={!primary}
              className="min-h-[52px] flex-1 rounded-xl bg-red-600 text-base font-semibold text-graphite-900 disabled:opacity-40"
            >
              {d.step === "summary" ? "Hand to customer" : "Continue"}
            </button>
          </div>
        </div>
      )}
    </div>
    </div>
  );
}
