import { useCallback, useEffect, useMemo, useRef, useState } from "react";
// The marketing site's faces, loaded here rather than in main.tsx because this
// is the only page wearing them. Playfair is only ever used italic.
import "@fontsource-variable/manrope";
import "@fontsource-variable/playfair-display/wght-italic.css";
import "./book.css";

/**
 * Public self-serve booking page (no auth, embedded on bhcardetails.com).
 *
 * The spine: the price is a destination, not a listing. The customer answers
 * three questions with no money on screen, then opens their price deliberately.
 * Once open they see what they picked beside the step up, and exactly which
 * work the upgrade adds.
 *
 * Everything priced here comes from GET /api/book/catalog, which reads the
 * services table -- the same rows the Settings > Services & pricing screen
 * edits. Nothing is hardcoded, and the figures shown are only ever a preview:
 * POST /api/book/quote re-prices server-side from that same table and never
 * trusts a number sent from this page.
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

/**
 * The three vehicle choices the customer sees, mapped onto the server's
 * vocabulary. The server carries ten types; showing all ten to somebody
 * booking a wash is noise, so these three cover the real spread.
 */
const VEHICLE_CHOICES = [
  { type: "sedan",    t: "Car",               d: "Sedan, coupe, convertible" },
  { type: "mid_suv",  t: "SUV or Truck",      d: "Also vans and three-row" },
  { type: "exotic",   t: "Luxury or Exotic",  d: "Porsche, Ferrari, Range Rover" },
];

/** Coverage maps straight onto services.area. */
const COVERAGE = [
  { id: "interior",  t: "Interior",         d: "Inside only" },
  { id: "exterior",  t: "Exterior",         d: "Outside only" },
  { id: "both",      t: "The whole car",    d: "Inside and out, priced together" },
  { id: "specialty", t: "Specialty work",   d: "Correction, ceramic, curb rash and more" },
];

/** Depth maps straight onto services.level. Order matters: it is the ladder. */
const DEPTH_ORDER = ["maintenance", "light", "full"];
const DEPTH_COPY: Record<string, { t: string; d: string }> = {
  maintenance: { t: "Maintenance", d: "Upkeep between details" },
  light:       { t: "Light",       d: "A proper refresh" },
  full:        { t: "Full",        d: "The deep one, nothing skipped" },
};

/**
 * What each tier includes, lifted verbatim from the package table published on
 * bhcardetails.com. This is marketing copy, not catalog data -- the services
 * table stores names and prices but no per-tier checklist -- so editing a
 * service in Settings changes the name and price here, not these lines.
 * Columns are [maintenance, light, full].
 */
const FEATURES: Record<"exterior" | "interior", Array<[string, number, number, number]>> = {
  exterior: [
    ["Foam bath & hand wash", 1, 1, 1],
    ["Spray sealant / drying aid", 1, 1, 1],
    ["Tires & rims cleaned + dressed", 0, 1, 1],
    ["Door jambs & gas cap cleaned", 0, 1, 1],
    ["Exterior glass streak-free finish", 0, 1, 1],
    ["Wheel wells cleaned", 0, 0, 1],
    ["Wax & ceramic seal (3 months)", 0, 0, 1],
    ["Clay bar decontamination", 0, 0, 1],
  ],
  interior: [
    ["Two-stage vacuum", 1, 1, 1],
    ["Floor mats cleaned", 1, 1, 1],
    ["Full air purge blow-out", 0, 1, 1],
    ["Plastic, vinyl & leather wiped down", 0, 1, 1],
    ["Interior glass streak-free finish", 0, 1, 1],
    ["Cloth seats shampooed & extracted", 0, 0, 1],
    ["Leather scrubbed & conditioned", 0, 0, 1],
  ],
};
const TIER_IX: Record<string, number> = { maintenance: 1, light: 2, full: 3 };

/**
 * Headlight restoration is priced per headlight, and it is the only line on the
 * menu with a quantity. The catalog has no per-unit flag, so it is recognised by
 * name -- renaming that service in Settings drops the counter back to one.
 */
const PER_UNIT = /headlight/i;
const PER_UNIT_MAX = 2;

const STEPS = ["vehicle", "coverage", "depth", "price", "addons", "when", "who", "done"] as const;
type Step = (typeof STEPS)[number];

const money = (cents: number) => `$${Math.round(cents / 100)}`;

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
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  const [step, setStep] = useState<Step>("vehicle");
  const [vehicleType, setVehicleType] = useState("");
  const [coverage, setCoverage] = useState("");
  const [depth, setDepth] = useState("");
  const [specialtyId, setSpecialtyId] = useState("");
  const [chosenDepth, setChosenDepth] = useState("");
  const [addons, setAddons] = useState<Record<string, number>>({});

  const [opened, setOpened] = useState(false);
  const [progress, setProgress] = useState(1);
  const vaultRef = useRef<HTMLDivElement | null>(null);
  const cardsRef = useRef<HTMLDivElement | null>(null);

  const [date, setDate] = useState(todayStr());
  const [slots, setSlots] = useState<string[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [slot, setSlot] = useState("");

  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [notes, setNotes] = useState("");
  const [consent, setConsent] = useState(false);
  const [website, setWebsite] = useState("");
  const [mountedAt] = useState(() => Date.now());

  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState("");
  const [result, setResult] = useState<{ status: string; job_id?: string } | null>(null);
  const shellRef = useRef<HTMLDivElement | null>(null);

  /**
   * Report our height so the embedding page can size its iframe to the step
   * being shown, instead of reserving the tallest step's worth of space.
   *
   * Deliberately measures the content shell, not the page: .bh-book carries
   * min-height:100dvh, which inside an iframe resolves to the iframe's own
   * height -- measuring that would feed our last answer back to us and the
   * frame could only ever grow.
   */
  const postHeight = useCallback(() => {
    const shell = shellRef.current;
    if (!shell || window.parent === window) return;
    const bar = document.querySelector<HTMLElement>(".bh-book .bar");
    const height = Math.ceil(shell.scrollHeight + (bar?.offsetHeight ?? 0) + 32);
    window.parent.postMessage({ type: "bh-book-height", height }, "*");
  }, []);

  // A ResizeObserver alone is not enough: its callbacks are delivered as part of
  // a rendering update, so a frame scrolled out of view or sitting in a
  // background tab may never get one and would keep a stale height. Posting on
  // the state changes that actually alter the layout does not depend on
  // anything being painted.
  useEffect(() => {
    const t = setTimeout(postHeight, 60);
    return () => clearTimeout(t);
  }, [step, opened, catalog, addons, slots, slotsLoading, err, postHeight]);

  useEffect(() => {
    const shell = shellRef.current;
    if (!shell || window.parent === window) return;
    const ro = new ResizeObserver(postHeight);
    ro.observe(shell);
    return () => ro.disconnect();
  }, [postHeight]);

  // The public endpoints are deliberately called with plain fetch: the shared
  // api() helper redirects a 401 to /login, which is the last thing a customer
  // should ever see.
  useEffect(() => {
    fetch("/api/book/catalog")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("catalog"))))
      .then((c: Catalog) => setCatalog(c))
      .catch(() => setLoadFailed(true));
  }, []);

  const bucket = useMemo(
    () => catalog?.vehicle_types.find((v) => v.value === vehicleType)?.bucket ?? "other",
    [catalog, vehicleType]
  );

  /** Sellable, non-add-on services. Specialty and planned work stay in even
      without a menu price -- they are quoted on sight, not hidden. */
  const primaries = useMemo(
    () => (catalog?.services ?? []).filter(
      (s) => s.standalone && !s.is_addon &&
        (priceFor(s, bucket) > 0 || s.requires_planning || s.level === "specialty")
    ),
    [catalog, bucket]
  );

  const specialties = useMemo(
    () => primaries.filter((s) => s.level === "specialty" || s.area === "specialty"),
    [primaries]
  );

  /** Which rungs of the ladder this coverage actually offers. */
  const depthsAvailable = useMemo(() => {
    const seen = new Set(primaries.filter((s) => s.area === coverage).map((s) => s.level ?? ""));
    return DEPTH_ORDER.filter((l) => seen.has(l));
  }, [primaries, coverage]);

  const serviceAt = useCallback(
    (lvl: string) => primaries.find((s) => s.area === coverage && s.level === lvl) ?? null,
    [primaries, coverage]
  );

  const addonOptions = useMemo(
    () => (catalog?.services ?? []).filter((s) => s.is_addon && priceFor(s, bucket) > 0),
    [catalog, bucket]
  );

  const specialty = useMemo(
    () => specialties.find((s) => s.id === specialtyId) ?? null,
    [specialties, specialtyId]
  );

  /** What they picked, and the rung above it when there is one. At the top the
      card stands alone -- never show a cheaper option beside what they chose. */
  const cardLevels = useMemo(() => {
    if (coverage === "specialty") return [];
    const i = depthsAvailable.indexOf(depth);
    if (i < 0) return [];
    return i < depthsAvailable.length - 1 ? [depthsAvailable[i], depthsAvailable[i + 1]] : [depthsAvailable[i]];
  }, [coverage, depth, depthsAvailable]);

  const chosen = useMemo(() => {
    if (coverage === "specialty") return specialty;
    return serviceAt(chosenDepth || depth);
  }, [coverage, specialty, serviceAt, chosenDepth, depth]);

  const needsPlanning = !!chosen?.requires_planning;
  const chosenPrice = chosen ? priceFor(chosen, bucket) : 0;
  const quoteOnly = !!chosen && chosenPrice <= 0;

  const addonTotal = useMemo(
    () => Object.entries(addons).reduce((sum, [id, qty]) => {
      const a = addonOptions.find((x) => x.id === id);
      return a ? sum + priceFor(a, bucket) * qty : sum;
    }, 0),
    [addons, addonOptions, bucket]
  );
  const total = (quoteOnly ? 0 : chosenPrice) + addonTotal;

  // ---- the reveal: grow the panel from its sealed shape to the cards' height
  useEffect(() => {
    if (!opened) return;
    const v = vaultRef.current, body = cardsRef.current;
    if (!v || !body) return;
    const target = body.scrollHeight;
    const id = requestAnimationFrame(() => { v.style.height = `${target}px`; });
    const t = setTimeout(() => { v.style.height = ""; }, 520);
    return () => { cancelAnimationFrame(id); clearTimeout(t); };
  }, [opened]);

  // ---- count the numbers up once the cover is off.
  // The count is decoration; the price is not. requestAnimationFrame is paused
  // in a backgrounded tab and in an iframe scrolled out of view, so a timer
  // always lands the real figure even if not a single frame is ever drawn --
  // otherwise a customer opens their price and reads $0.
  useEffect(() => {
    if (!opened) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { setProgress(1); return; }
    let raf = 0, t0 = 0;
    const tick = (ts: number) => {
      if (!t0) t0 = ts;
      const p = Math.min(1, (ts - t0) / 620);
      setProgress(1 - Math.pow(1 - p, 3));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    setProgress(0);
    raf = requestAnimationFrame(tick);
    const settle = setTimeout(() => setProgress(1), 800);
    return () => { cancelAnimationFrame(raf); clearTimeout(settle); };
  }, [opened]);

  // ---- live slots
  useEffect(() => {
    if (step !== "when" || needsPlanning) return;
    setSlot(""); setSlots([]); setSlotsLoading(true);
    fetch(`/api/book/availability?date=${date}`)
      .then((r) => r.json())
      .then((r: { slots: string[] }) => setSlots(r.slots ?? []))
      .catch(() => setSlots([]))
      .finally(() => setSlotsLoading(false));
  }, [step, date, needsPlanning]);

  // ---- a drop-off is still a lead worth calling. Saved once there is a name
  // and a phone; sets no consent, so it is callable, never textable.
  useEffect(() => {
    const nm = fullName.trim();
    if (!nm || !phone.trim()) return;
    const t = setTimeout(() => {
      fetch("/api/book/lead", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: nm, phone, email, website }),
      }).catch(() => {});
    }, 1200);
    return () => clearTimeout(t);
  }, [fullName, phone, email, website]);

  function reveal() {
    const v = vaultRef.current;
    if (v) v.style.height = `${v.getBoundingClientRect().height}px`;
    setOpened(true);
  }

  function goTo(s: Step) {
    setStep(s);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function pickCoverage(id: string) {
    setCoverage(id);
    setDepth(""); setChosenDepth(""); setSpecialtyId(""); setOpened(false);
    goTo("depth");
  }

  function pickDepth(lvl: string) {
    setDepth(lvl); setChosenDepth(lvl); setOpened(false);
    goTo("price");
  }

  function pickSpecialty(id: string) {
    setSpecialtyId(id); setOpened(false);
    goTo("price");
  }

  function toggleAddon(s: Service) {
    setAddons((prev) => {
      const next = { ...prev };
      if (next[s.id]) delete next[s.id];
      else next[s.id] = 1;
      return next;
    });
  }

  function stepQty(s: Service, by: number) {
    setAddons((prev) => {
      const cur = prev[s.id] ?? 1;
      return { ...prev, [s.id]: Math.min(PER_UNIT_MAX, Math.max(1, cur + by)) };
    });
  }

  const back = () => {
    const order: Step[] = coverage === "specialty"
      ? ["vehicle", "coverage", "depth", "price", "addons", "when", "who"]
      : [...STEPS].slice(0, 7) as Step[];
    const i = order.indexOf(step);
    goTo(order[Math.max(0, i - 1)]);
  };

  async function submit() {
    setErr("");
    if (!consent) { setErr("Please tick the box so we can text you about your booking."); return; }
    if (!phone.trim()) { setErr("Add a phone number so we can confirm."); return; }
    if (!needsPlanning && !slot) { setErr("Pick a time first."); return; }
    if (!chosen) { setErr("Choose a service first."); return; }

    setSubmitting(true);
    try {
      const lines = [
        { service_id: chosen.id, qty: 1 },
        ...Object.entries(addons).map(([id, qty]) => ({ service_id: id, qty })),
      ];
      const res = await fetch("/api/book/quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vehicle_type: vehicleType,
          lines,
          scheduled_start: needsPlanning ? null : slot,
          // The server stores first/last separately; one field is less to type
          // on a phone, so the split happens here. A single-word name keeps an
          // empty surname rather than guessing at one.
          first_name: fullName.trim().split(/\s+/)[0] ?? "",
          last_name: fullName.trim().split(/\s+/).slice(1).join(" "),
          phone, email, address, notes,
          sms_opt_in: consent,
          website, ts: mountedAt,
        }),
      });
      const body = await res.json().catch(() => null);
      if (res.status === 409) { setErr("That time was just taken. Pick another."); goTo("when"); return; }
      if (!res.ok || !body?.ok) {
        setErr(body?.error === "consent_required"
          ? "Please tick the consent box to continue."
          : "That didn't go through. Try again, or call us on (917) 783-1038.");
        return;
      }
      setResult({ status: body.status, job_id: body.job_id });
      goTo("done");
      window.parent?.postMessage({ type: "bh-booking-complete", status: body.status }, "*");
    } catch {
      setErr("That didn't go through. Try again, or call us on (917) 783-1038.");
    } finally {
      setSubmitting(false);
    }
  }

  if (loadFailed) {
    return (
      <div className="bh-book">
        <div className="shell">
          <div className="step">
            <h1 className="ask">We can't load pricing <em>right now.</em></h1>
            <p className="hint">
              Call or text us on <a href="tel:+19177831038" style={{ color: "#ff4153" }}>(917) 783-1038</a> and
              we'll quote you directly.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const stepIx = STEPS.indexOf(step);
  const showMoney = opened && stepIx >= STEPS.indexOf("price") && step !== "done";
  const canContinue =
    (step === "price" && opened) ||
    step === "addons" ||
    (step === "when" && (needsPlanning || !!slot));

  const crumbs: Array<{ label: string; to: Step }> = [];
  if (vehicleType) crumbs.push({ label: VEHICLE_CHOICES.find((v) => v.type === vehicleType)!.t, to: "vehicle" });
  if (coverage) crumbs.push({ label: COVERAGE.find((c) => c.id === coverage)!.t, to: "coverage" });
  if (coverage !== "specialty" && depth) crumbs.push({ label: DEPTH_COPY[depth]?.t ?? depth, to: "depth" });
  if (specialty) crumbs.push({ label: specialty.name, to: "depth" });

  return (
    <div className="bh-book">
      <div className="shell" ref={shellRef}>
        {step !== "done" && (
          <>
            <div className="rail">
              {STEPS.slice(0, 7).map((s, i) => (
                <i key={s} className={i <= stepIx ? "on" : ""} />
              ))}
            </div>
            <div className="crumbs">
              {crumbs.map((c) => (
                <button key={c.label} type="button" className="crumb" onClick={() => goTo(c.to)}>
                  {c.label}
                </button>
              ))}
            </div>
          </>
        )}

        {!catalog && !loadFailed && (
          <div className="step"><p className="hint">Loading the menu…</p></div>
        )}

        {catalog && step === "vehicle" && (
          <section className="step">
            <h1 className="ask">What are we <em>detailing?</em></h1>
            <p className="hint">Size and finish change what the job takes, so this sets your price.</p>
            <div className="opts">
              {VEHICLE_CHOICES.map((v) => (
                <button key={v.type} type="button" className="opt"
                  aria-pressed={vehicleType === v.type}
                  onClick={() => { setVehicleType(v.type); setOpened(false); goTo("coverage"); }}>
                  <span className="txt"><span className="t">{v.t}</span><span className="d">{v.d}</span></span>
                  <span className="go" aria-hidden>&rsaquo;</span>
                </button>
              ))}
            </div>
          </section>
        )}

        {catalog && step === "coverage" && (
          <section className="step">
            <h1 className="ask">What needs the <em>work?</em></h1>
            <p className="hint">Inside, outside, or the whole car.</p>
            <div className="opts">
              {COVERAGE.map((c) => (
                <button key={c.id} type="button" className="opt"
                  aria-pressed={coverage === c.id}
                  onClick={() => pickCoverage(c.id)}>
                  <span className="txt"><span className="t">{c.t}</span><span className="d">{c.d}</span></span>
                  <span className="go" aria-hidden>&rsaquo;</span>
                </button>
              ))}
            </div>
          </section>
        )}

        {catalog && step === "depth" && coverage !== "specialty" && (
          <section className="step">
            <h1 className="ask">How far do we <em>take it?</em></h1>
            <p className="hint">Pick the level of work. You'll see your price next.</p>
            <div className="opts">
              {depthsAvailable.map((l) => (
                <button key={l} type="button" className="opt"
                  aria-pressed={depth === l}
                  onClick={() => pickDepth(l)}>
                  <span className="txt">
                    <span className="t">{DEPTH_COPY[l]?.t ?? l}</span>
                    <span className="d">{DEPTH_COPY[l]?.d ?? ""}</span>
                  </span>
                  <span className="go" aria-hidden>&rsaquo;</span>
                </button>
              ))}
            </div>
          </section>
        )}

        {catalog && step === "depth" && coverage === "specialty" && (
          <section className="step">
            <h1 className="ask">Which <em>specialty?</em></h1>
            <p className="hint">Some of these we price on sight rather than off a menu.</p>
            <div className="opts">
              {specialties.map((s) => (
                <button key={s.id} type="button" className="opt"
                  aria-pressed={specialtyId === s.id}
                  onClick={() => pickSpecialty(s.id)}>
                  <span className="txt">
                    <span className="t">{s.name}</span>
                    <span className="d">{s.description ?? ""}</span>
                  </span>
                  <span className="go" aria-hidden>&rsaquo;</span>
                </button>
              ))}
            </div>
          </section>
        )}

        {catalog && step === "price" && chosen && (
          <section className="step">
            <h1 className="ask">Your price is <em>ready.</em></h1>
            <p className="hint">Open it to see what your detail costs, and what it includes.</p>

            <div ref={vaultRef} className={`vault${opened ? "" : " sealed"}`}>
              <span className={`sheen${opened ? " go" : ""}`} aria-hidden />
              <div className={`vault-cover${opened ? " off" : ""}`}>
                <span className="lead">Quoted for</span>
                <span className="what">{chosen.name}</span>
                <button type="button" className="reveal-btn" onClick={reveal}>Show my price</button>
              </div>

              {/* Painting over a price is not hiding it: without inert the
                  numbers are still reachable by find-in-page and screen readers
                  before the customer has opened anything. */}
              <div
                ref={cardsRef}
                className="vault-body"
                {...(!opened ? { inert: "" as unknown as boolean, "aria-hidden": true } : {})}
              >
                {coverage === "specialty" && specialty && (
                  <div className="card" data-sel="1">
                    <span className="tag you">Your pick</span>
                    <div className="card-top">
                      <h3>{specialty.name}</h3>
                      <span className={`amt${priceFor(specialty, bucket) <= 0 ? " q" : ""}`}>
                        {priceFor(specialty, bucket) > 0
                          ? money(Math.round(priceFor(specialty, bucket) * progress))
                          : "We'll quote it"}
                      </span>
                    </div>
                    {specialty.description && <p className="only">{specialty.description}</p>}
                  </div>
                )}

                {coverage !== "specialty" && cardLevels.map((lvl, i) => {
                  const svc = serviceAt(lvl);
                  if (!svc) return null;
                  const mine = lvl === depth;
                  const lower = cardLevels[0];
                  const isUpper = i === 1;
                  const lowerSvc = serviceAt(lower);
                  const diff = isUpper && lowerSvc ? priceFor(svc, bucket) - priceFor(lowerSvc, bucket) : 0;
                  const groups: Array<"exterior" | "interior"> =
                    coverage === "both" ? ["exterior", "interior"] : [coverage as "exterior" | "interior"];
                  const ix = TIER_IX[lvl] ?? 1;
                  const prevIx = isUpper ? TIER_IX[lower] ?? 0 : 0;
                  return (
                    <button
                      key={lvl}
                      type="button"
                      className="card"
                      data-sel={(chosenDepth || depth) === lvl ? "1" : "0"}
                      onClick={() => setChosenDepth(lvl)}
                    >
                      <span className={`tag ${mine ? "you" : "up"}`}>
                        {mine ? "Your pick" : "Step up"}
                      </span>
                      <div className="card-top">
                        <h3>{svc.name}</h3>
                        <span>
                          <span className="amt">{money(Math.round(priceFor(svc, bucket) * progress))}</span>
                          {diff > 0 && <span className="delta">+{money(diff)} more</span>}
                        </span>
                      </div>
                      <div className="inc">
                        {groups.map((g) => (
                          <div className="inc-g" key={g}>
                            <b>{g}</b>
                            <ul>
                              {FEATURES[g].filter((r) => r[ix]).map((r) => (
                                <li key={r[0]} className={prevIx && !r[prevIx] ? "new" : undefined}>{r[0]}</li>
                              ))}
                            </ul>
                          </div>
                        ))}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </section>
        )}

        {catalog && step === "addons" && (
          <section className="step">
            <h1 className="ask">Anything <em>else?</em></h1>
            <p className="hint">Optional. Skip straight past if you don't need any.</p>
            <div className="opts">
              {addonOptions.length === 0 && <p className="hint">Nothing else priced for this vehicle right now.</p>}
              {addonOptions.map((a) => {
                const on = !!addons[a.id];
                const perUnit = PER_UNIT.test(a.name);
                return (
                  <div key={a.id} className="add" data-on={on ? "1" : "0"}
                    role="button" tabIndex={0}
                    onClick={() => toggleAddon(a)}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleAddon(a); } }}>
                    <span className="bx" aria-hidden>✓</span>
                    <span className="nm">{a.name}</span>
                    <span className="pr">+{money(priceFor(a, bucket))}{perUnit ? " ea" : ""}</span>
                    {perUnit && on && (
                      <span className="qty" onClick={(e) => e.stopPropagation()}>
                        <button type="button" aria-label="One fewer headlight" onClick={() => stepQty(a, -1)}>−</button>
                        <span>{addons[a.id]}</span>
                        <button type="button" aria-label="One more headlight" onClick={() => stepQty(a, 1)}>+</button>
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {catalog && step === "when" && (
          <section className="step">
            {needsPlanning ? (
              <>
                <h1 className="ask">We'll call to <em>book this in.</em></h1>
                <p className="hint">
                  This one needs a look before we lock a date. Add your details next and we'll
                  confirm scheduling and the final price on the phone.
                </p>
              </>
            ) : (
              <>
                <h1 className="ask">When suits <em>you?</em></h1>
                <p className="hint">Two-hour arrival windows. We come to you.</p>
                <div className="opts">
                  <input className="date-in" type="date" min={todayStr()} value={date}
                    onChange={(e) => setDate(e.target.value)} aria-label="Date" />
                </div>
                <div className="slots">
                  {slotsLoading && <p className="hint">Loading times…</p>}
                  {!slotsLoading && slots.length === 0 && <p className="hint">Nothing open that day. Try another date.</p>}
                  {slots.map((s) => (
                    <button key={s} type="button" aria-pressed={slot === s} onClick={() => setSlot(s)}>
                      {new Date(s).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                    </button>
                  ))}
                </div>
              </>
            )}
          </section>
        )}

        {catalog && step === "who" && (
          <section className="step">
            <h1 className="ask">Where do we <em>find you?</em></h1>
            <p className="hint">We confirm by text before we set off.</p>
            <div className="fields">
              <input type="text" placeholder="Full name" autoComplete="name"
                value={fullName} onChange={(e) => setFullName(e.target.value)} />
              <input type="tel" inputMode="tel" placeholder="Phone" autoComplete="tel"
                value={phone} onChange={(e) => setPhone(e.target.value)} />
              <input type="email" inputMode="email" placeholder="Email (optional)" autoComplete="email"
                value={email} onChange={(e) => setEmail(e.target.value)} />
              <input type="text" placeholder="Address" autoComplete="street-address"
                value={address} onChange={(e) => setAddress(e.target.value)} />
              <textarea rows={2} placeholder="Notes — pet hair, problem spots, gate code"
                value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>

            <input className="hp" tabIndex={-1} autoComplete="off" aria-hidden="true"
              value={website} onChange={(e) => setWebsite(e.target.value)} />

            <label className="consent">
              <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
              {/* Wording is identical everywhere a phone number is collected --
                  the site forms, this page, the QR intake and the quote builder. */}
              <span>
                Yes, text me about my quote and appointment updates from BH Car Detailing. Msg &amp; data
                rates may apply. Msg frequency varies. Reply STOP to opt out anytime.{" "}
                <a href="https://bhcardetails.com/terms.html" target="_blank" rel="noreferrer">Terms</a>
                {" · "}
                <a href="https://bhcardetails.com/privacy-policy.html" target="_blank" rel="noreferrer">Privacy</a>
              </span>
            </label>

            <p className="fine">
              A travel fee applies more than 15 miles out, confirmed before we arrive. Heavily soiled
              vehicles may be adjusted at booking.
            </p>
            {err && <p className="err">{err}</p>}
          </section>
        )}

        {step === "done" && result && (
          <section className="step done">
            <div className="mark" aria-hidden>✓</div>
            <h1 className="ask">
              {result.status === "scheduled" ? <>You're <em>booked in.</em></> : <>Got it — <em>we'll call.</em></>}
            </h1>
            <p>
              {result.status === "scheduled"
                ? <>{chosen?.name} on {slot ? new Date(slot).toLocaleString([], { weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" }) : "your chosen time"}. We'll text you to confirm.</>
                : <>We'll call shortly to confirm scheduling and the final price for {chosen?.name}.</>}
            </p>
            {result.job_id && <p className="ref">Reference {result.job_id.slice(0, 8).toUpperCase()}</p>}
          </section>
        )}
      </div>

      {catalog && step !== "done" && (
        <div className="bar">
          <div className="bar-in">
            {step !== "vehicle" && (
              <button type="button" className="back" onClick={back}>Back</button>
            )}
            {showMoney && chosen && (
              <>
                <div className="lbl">
                  <b>{chosen.name}</b>
                  <small>
                    {VEHICLE_CHOICES.find((v) => v.type === vehicleType)?.t}
                    {Object.keys(addons).length > 0 && ` · ${Object.keys(addons).length} add-on${Object.keys(addons).length > 1 ? "s" : ""}`}
                  </small>
                </div>
                <div className="tot">
                  {quoteOnly ? (addonTotal ? `${money(addonTotal)} + quote` : "Quote") : money(total)}
                </div>
              </>
            )}
            {step === "who" ? (
              <button type="button" className="cta" onClick={submit} disabled={submitting}>
                {submitting ? "Sending…" : quoteOnly || needsPlanning ? "Request my quote" : "Confirm booking"}
              </button>
            ) : (
              (step === "price" || step === "addons" || step === "when") && (
                <button type="button" className="cta" disabled={!canContinue}
                  onClick={() => goTo(step === "price" ? "addons" : step === "addons" ? "when" : "who")}>
                  {step === "price" ? "Looks good" : step === "addons"
                    ? (Object.keys(addons).length ? "Continue" : "No thanks")
                    : "Continue"}
                </button>
              )
            )}
          </div>
        </div>
      )}
    </div>
  );
}
