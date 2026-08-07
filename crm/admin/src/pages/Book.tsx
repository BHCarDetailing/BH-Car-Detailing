import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { Button, Field, Input } from "../components/ui";

/**
 * Public self-serve pricing + booking wizard.
 *
 * Embedded in an iframe on bhcardetails.com (replaces what used to be a
 * Calendly widget with no pricing). Prices shown here are for the customer's
 * benefit only — the actual charge/booking is always recomputed server-side
 * in POST /api/book/quote from the same services table, never trusted from
 * this page's state.
 */

interface Service {
  id: string;
  name: string;
  description: string | null;
  size_pricing: Record<string, number>;
  base_price_cents: number;
  duration_min: number | null;
  is_addon: boolean;
  standalone: boolean;
  requires_planning: boolean;
  level: string | null;
  area: string | null;
}
interface VehicleTypeOption { value: string; label: string; bucket: string; note?: string }
interface Catalog { vehicle_types: VehicleTypeOption[]; services: Service[] }

type Step = "vehicle" | "service" | "addons" | "schedule" | "contact" | "done";
const STEP_ORDER: Step[] = ["vehicle", "service", "addons", "schedule", "contact", "done"];

const LEVEL_LABELS: Record<string, string> = {
  maintenance: "Maintenance",
  light: "Signature",
  full: "Complete",
  specialty: "Specialty",
};

const money = (cents: number) => `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;

function duration(mins: number): string {
  if (!mins) return "";
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h ? `~${h}h${m ? ` ${m}m` : ""}` : `~${m}m`;
}

/** Mirrors the server's pricing: explicit size price, else the base price. */
function priceFor(svc: Service, bucket: string): number {
  const p = svc.size_pricing?.[bucket];
  return Number.isFinite(p) && p > 0 ? Math.round(p) : Math.max(0, Math.round(svc.base_price_cents));
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function Book() {
  const [step, setStep] = useState<Step>("vehicle");
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [catalogErr, setCatalogErr] = useState(false);

  const [vehicleTypeValue, setVehicleTypeValue] = useState("");
  const [primaryId, setPrimaryId] = useState("");
  const [addonIds, setAddonIds] = useState<string[]>([]);

  const [date, setDate] = useState(todayStr());
  const [slots, setSlots] = useState<string[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [slot, setSlot] = useState("");

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [notes, setNotes] = useState("");
  const [consent, setConsent] = useState(false);
  const [website, setWebsite] = useState(""); // honeypot
  const [mountedAt] = useState(() => Date.now());

  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState("");
  const [result, setResult] = useState<{ status: string; scheduled_start: string | null } | null>(null);

  useEffect(() => {
    api<Catalog>("/api/book/catalog").then(setCatalog).catch(() => setCatalogErr(true));
  }, []);

  const bucket = useMemo(
    () => catalog?.vehicle_types.find((v) => v.value === vehicleTypeValue)?.bucket ?? "other",
    [catalog, vehicleTypeValue]
  );
  const primaryOptions = useMemo(
    () => (catalog?.services ?? []).filter((s) => s.standalone && !s.is_addon),
    [catalog]
  );
  const primaryByLevel = useMemo(() => {
    const groups: Record<string, Service[]> = {};
    for (const s of primaryOptions) (groups[s.level ?? "specialty"] ??= []).push(s);
    return groups;
  }, [primaryOptions]);
  const primary = useMemo(() => primaryOptions.find((s) => s.id === primaryId) ?? null, [primaryOptions, primaryId]);
  const addonOptions = useMemo(
    () => (catalog?.services ?? []).filter((s) => s.is_addon && priceFor(s, bucket) > 0),
    [catalog, bucket]
  );
  const chosenAddons = useMemo(() => addonOptions.filter((a) => addonIds.includes(a.id)), [addonOptions, addonIds]);

  const needsPlanning = !!primary?.requires_planning;
  const totalCents = (primary ? priceFor(primary, bucket) : 0) + chosenAddons.reduce((s, a) => s + priceFor(a, bucket), 0);
  const totalMinutes = (primary?.duration_min ?? 0) + chosenAddons.reduce((s, a) => s + (a.duration_min ?? 0), 0);
  const priceIsReal = !!primary && priceFor(primary, bucket) > 0;

  // Live slots, loaded when the schedule step needs them.
  useEffect(() => {
    if (step !== "schedule" || needsPlanning) return;
    setSlot(""); setSlots([]); setSlotsLoading(true);
    api<{ slots: string[] }>(`/api/book/availability?date=${date}`)
      .then((r) => setSlots(r.slots)).catch(() => setSlots([])).finally(() => setSlotsLoading(false));
  }, [step, date, needsPlanning]);

  // Save an incomplete lead as soon as name + phone are both filled in, even
  // if they never finish — a drop-off becomes a callable lead, not lost data.
  useEffect(() => {
    if (!name.trim() || !phone.trim()) return;
    const t = setTimeout(() => {
      fetch("/api/book/lead", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, phone, email, website }),
      }).catch(() => {});
    }, 1200);
    return () => clearTimeout(t);
  }, [name, phone, email, website]);

  function toggleAddon(id: string) {
    setAddonIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function goNext() {
    const i = STEP_ORDER.indexOf(step);
    setStep(STEP_ORDER[Math.min(i + 1, STEP_ORDER.length - 1)]);
  }
  function goBack() {
    const i = STEP_ORDER.indexOf(step);
    setStep(STEP_ORDER[Math.max(i - 1, 0)]);
  }

  async function submit() {
    setErr("");
    if (!consent) { setErr("Please check the box to confirm you'd like a text about your appointment."); return; }
    if (!phone.trim()) { setErr("Add a phone number."); return; }
    if (!needsPlanning && !slot) { setErr("Pick a time."); return; }
    setSubmitting(true);
    try {
      const lines = [primaryId, ...addonIds].filter(Boolean).map((service_id) => ({ service_id, qty: 1 }));
      const res = await fetch("/api/book/quote", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vehicle_type: vehicleTypeValue, lines,
          scheduled_start: needsPlanning ? null : slot,
          first_name: name.split(" ")[0] || "", last_name: name.split(" ").slice(1).join(" "),
          phone, email, address, notes, sms_opt_in: consent, website, ts: mountedAt,
        }),
      });
      const body = await res.json().catch(() => null);
      if (res.status === 409) { setErr("That time was just taken — pick another."); setStep("schedule"); return; }
      if (!res.ok || !body?.ok) {
        setErr(body?.error === "consent_required" ? "Please check the consent box to continue." : "Something went wrong — try again.");
        return;
      }
      setResult({ status: body.status, scheduled_start: body.status === "scheduled" ? slot : null });
      setStep("done");
      window.parent?.postMessage({ type: "bh-booking-complete", status: body.status }, "*");
    } catch { setErr("Something went wrong — try again."); }
    finally { setSubmitting(false); }
  }

  if (catalogErr) {
    return (
      <div className="mx-auto max-w-md p-6 text-center">
        <p className="text-sm text-neutral-600">Couldn't load pricing right now. Call or text us at <a className="text-red-600 underline" href="tel:+19177831038">(917) 783-1038</a>.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md p-4 sm:p-6">
      <div className="mb-5 flex flex-col items-center text-center">
        <img src="/brand/logo.png" alt="BH Car Detailing" className="mb-3 h-14 w-auto" />
        <h1 className="font-display text-2xl leading-none text-graphite-950">Get Your Price &amp; Book</h1>
        <p className="eyebrow mt-1.5 text-[10px] text-chrome-400">Miami · Fort Lauderdale</p>
      </div>

      {step !== "done" && (
        <div className="mb-5 flex gap-1.5">
          {STEP_ORDER.slice(0, -1).map((s, i) => (
            <span key={s} className={`h-1 flex-1 rounded-full ${STEP_ORDER.indexOf(step) >= i ? "bg-red-600" : "bg-steel-200"}`} />
          ))}
        </div>
      )}

      {!catalog && step !== "done" && <p className="text-sm text-neutral-400">Loading pricing…</p>}

      {catalog && step === "vehicle" && (
        <div className="space-y-4">
          <p className="text-sm font-medium text-graphite-900">What are we detailing?</p>
          <div className="grid grid-cols-2 gap-2">
            {catalog.vehicle_types.map((v) => (
              <button key={v.value} type="button" onClick={() => { setVehicleTypeValue(v.value); goNext(); }}
                className={`min-h-[52px] rounded-lg border px-3 py-2 text-left text-sm font-medium transition ${vehicleTypeValue === v.value ? "border-red-600 bg-red-50 text-red-700" : "border-steel-200 bg-white text-graphite-800 hover:border-red-300"}`}>
                {v.label}
                {v.note && <span className="mt-0.5 block text-[11px] font-normal text-neutral-400">{v.note}</span>}
              </button>
            ))}
          </div>
        </div>
      )}

      {catalog && step === "service" && (
        <div className="space-y-5">
          <p className="text-sm font-medium text-graphite-900">Choose your service</p>
          {["maintenance", "light", "full", "specialty"].map((level) =>
            primaryByLevel[level]?.length ? (
              <div key={level}>
                <p className="eyebrow mb-2 text-[10px] text-chrome-400">{LEVEL_LABELS[level] ?? level}</p>
                <div className="space-y-2">
                  {primaryByLevel[level].map((s) => {
                    const p = priceFor(s, bucket);
                    const quoteOnly = s.requires_planning || (p <= 0);
                    return (
                      <button key={s.id} type="button" onClick={() => { setPrimaryId(s.id); }}
                        className={`flex w-full items-start justify-between gap-3 rounded-lg border px-3.5 py-3 text-left transition ${primaryId === s.id ? "border-red-600 bg-red-50" : "border-steel-200 bg-white hover:border-red-300"}`}>
                        <span>
                          <span className="block text-sm font-medium text-graphite-900">{s.name}</span>
                          {s.description && <span className="mt-0.5 block text-xs text-neutral-500">{s.description}</span>}
                          {s.duration_min ? <span className="mt-0.5 block text-[11px] text-neutral-400">{duration(s.duration_min)}</span> : null}
                        </span>
                        <span className="shrink-0 text-sm font-semibold text-graphite-900">{quoteOnly ? "Quote" : money(p)}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null
          )}
          <div className="flex gap-2 pt-1">
            <Button variant="ghost" onClick={goBack}>Back</Button>
            <Button onClick={goNext} disabled={!primaryId} className="flex-1">Continue</Button>
          </div>
        </div>
      )}

      {catalog && step === "addons" && (
        <div className="space-y-4">
          <p className="text-sm font-medium text-graphite-900">Add anything on top? <span className="font-normal text-neutral-400">(optional)</span></p>
          {addonOptions.length === 0 ? (
            <p className="text-sm text-neutral-400">Nothing else priced for this vehicle right now.</p>
          ) : (
            <div className="space-y-2">
              {addonOptions.map((a) => (
                <label key={a.id} className={`flex cursor-pointer items-center justify-between gap-3 rounded-lg border px-3.5 py-3 transition ${addonIds.includes(a.id) ? "border-red-600 bg-red-50" : "border-steel-200 bg-white"}`}>
                  <span className="flex items-center gap-2.5">
                    <input type="checkbox" checked={addonIds.includes(a.id)} onChange={() => toggleAddon(a.id)} />
                    <span className="text-sm font-medium text-graphite-900">{a.name}</span>
                  </span>
                  <span className="shrink-0 text-sm font-semibold text-graphite-900">+{money(priceFor(a, bucket))}</span>
                </label>
              ))}
            </div>
          )}
          {priceIsReal && (
            <div className="flex items-center justify-between rounded-lg bg-steel-100 px-3.5 py-3 text-sm">
              <span className="text-neutral-500">Estimated total</span>
              <span className="font-display text-lg text-graphite-950">{money(totalCents)}{totalMinutes ? <span className="ml-2 text-xs font-normal text-neutral-400">{duration(totalMinutes)}</span> : null}</span>
            </div>
          )}
          <div className="flex gap-2 pt-1">
            <Button variant="ghost" onClick={goBack}>Back</Button>
            <Button onClick={goNext} className="flex-1">Continue</Button>
          </div>
        </div>
      )}

      {catalog && step === "schedule" && (
        <div className="space-y-4">
          {needsPlanning ? (
            <div className="rounded-lg border border-steel-200 bg-steel-50 px-4 py-4 text-sm text-neutral-600">
              <p className="font-medium text-graphite-900">This one needs a quick look before we lock a date.</p>
              <p className="mt-1">We'll call you to confirm scheduling and final pricing. Add your info next and any notes about the job.</p>
            </div>
          ) : (
            <>
              <p className="text-sm font-medium text-graphite-900">Pick a day and time</p>
              <Field label="Date">
                <Input type="date" min={todayStr()} value={date} onChange={(e) => setDate(e.target.value)} />
              </Field>
              <div>
                <span className="mb-1 block text-xs font-medium text-neutral-600">Available times</span>
                {slotsLoading ? <p className="text-sm text-neutral-400">Loading…</p> :
                  slots.length === 0 ? <p className="text-sm text-neutral-400">No open times that day — try another date.</p> :
                    <div className="flex flex-wrap gap-2">
                      {slots.map((s) => (
                        <button type="button" key={s} onClick={() => setSlot(s)}
                          className={`min-h-[40px] rounded-md px-3 text-sm font-medium ${slot === s ? "bg-red-600 text-white" : "bg-steel-100 text-graphite-800 hover:bg-steel-200"}`}>
                          {new Date(s).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                        </button>
                      ))}
                    </div>}
              </div>
            </>
          )}
          <div className="flex gap-2 pt-1">
            <Button variant="ghost" onClick={goBack}>Back</Button>
            <Button onClick={goNext} disabled={!needsPlanning && !slot} className="flex-1">Continue</Button>
          </div>
        </div>
      )}

      {catalog && step === "contact" && (
        <div className="space-y-3">
          <p className="text-sm font-medium text-graphite-900">Your info</p>
          <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" /></Field>
          <Field label="Phone"><Input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" placeholder="Phone number" /></Field>
          <Field label="Email (optional)"><Input value={email} onChange={(e) => setEmail(e.target.value)} inputMode="email" placeholder="Email" /></Field>
          <Field label="Where should we come? (address)"><Input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Address" /></Field>
          <Field label="Notes (optional)"><Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={needsPlanning ? "Preferred day/time, damage details, etc." : "Anything we should know"} /></Field>
          <input value={website} onChange={(e) => setWebsite(e.target.value)} tabIndex={-1} autoComplete="off" className="hidden" aria-hidden="true" />

          <label className="flex items-start gap-2 pt-1 text-xs leading-relaxed text-neutral-500">
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5" required />
            <span>
              Yes, text me about my quote and appointment updates from BH Car Detailing. Msg &amp; data rates may apply. Msg frequency varies. Reply STOP to opt out anytime.{" "}
              <a href="https://bhcardetails.com/terms.html" target="_blank" rel="noreferrer" className="text-red-600 underline">Terms</a>
              {" · "}
              <a href="https://bhcardetails.com/privacy-policy.html" target="_blank" rel="noreferrer" className="text-red-600 underline">Privacy</a>
            </span>
          </label>

          {priceIsReal && (
            <div className="flex items-center justify-between rounded-lg bg-steel-100 px-3.5 py-3 text-sm">
              <span className="text-neutral-500">{needsPlanning ? "Estimated (confirmed on the call)" : "Total"}</span>
              <span className="font-display text-lg text-graphite-950">{money(totalCents)}</span>
            </div>
          )}

          {err && <p className="text-sm text-red-600">{err}</p>}
          <div className="flex gap-2 pt-1">
            <Button variant="ghost" onClick={goBack} disabled={submitting}>Back</Button>
            <Button onClick={submit} disabled={submitting} className="flex-1">
              {submitting ? "Booking…" : needsPlanning ? "Request Callback" : "Confirm Booking"}
            </Button>
          </div>
        </div>
      )}

      {step === "done" && result && (
        <div className="py-4 text-center">
          <img src="/brand/logo.png" alt="BH Car Detailing" className="mx-auto mb-5 h-14 w-auto" />
          <h2 className="font-display text-2xl text-graphite-950">
            {result.status === "scheduled" ? "You're booked! 🎉" : "Got it — we'll call you 📞"}
          </h2>
          <p className="mt-2 text-sm text-neutral-600">
            {result.status === "scheduled" && result.scheduled_start
              ? <>We've got you down for {primary?.name} on {new Date(result.scheduled_start).toLocaleString()}. We'll be in touch to confirm.</>
              : <>We'll call you shortly to confirm scheduling and final pricing for {primary?.name}.</>}
          </p>
        </div>
      )}
    </div>
  );
}
