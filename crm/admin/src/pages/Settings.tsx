import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { money, SIZE_CLASSES, type Label, type Service, type SizeClass } from "../types";

const DEFAULT_TEMPLATE = "Hi {first_name}, this is BH Car Detailing — thanks for reaching out! Happy to get you a quote. When works for a quick call or text?";
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DEFAULT_HOURS = { days: [1, 2, 3, 4, 5, 6], start: "09:00", end: "18:00", slot_min: 120, buffer_min: 30 };
const DEFAULT_MISSED_BODY = "Hey, this is BH Car Detailing - sorry we missed your call! Reply here with what you need and we'll be in touch.\nIf you'd like to book on your own our website is bhcardetails.com";

function ServicesManager() {
  const [items, setItems] = useState<Service[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [note, setNote] = useState("");

  const load = () => api<{ items: Service[] }>("/api/services").then((r) => setItems(r.items)).catch(() => {});
  useEffect(() => { load(); }, []);

  async function addBlank() {
    const r = (await api("/api/services", { method: "POST", body: JSON.stringify({ name: "New service", size_pricing: {}, sort: (items.length + 1) * 10 }) })) as { id: string };
    await load();
    setEditing(r.id);
  }
  async function save(s: Service) {
    setNote("");
    try {
      await api(`/api/services/${s.id}`, { method: "PATCH", body: JSON.stringify({ name: s.name, description: s.description, size_pricing: s.size_pricing, active: s.active, sort: s.sort }) });
      setEditing(null); setNote("Saved."); load();
    } catch { setNote("Couldn't save — try again."); }
  }
  async function del(id: string) {
    await api(`/api/services/${id}`, { method: "DELETE" });
    load();
  }
  function patchLocal(id: string, patch: Partial<Service>) {
    setItems((xs) => xs.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  }
  function setPrice(id: string, size: SizeClass, dollars: string) {
    const cents = Math.max(0, Math.round((parseFloat(dollars) || 0) * 100));
    setItems((xs) => xs.map((x) => (x.id === id ? { ...x, size_pricing: { ...x.size_pricing, [size]: cents } } : x)));
  }

  return (
    <section className="rounded-xl bg-white p-5 shadow-sm">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="font-medium">Services & pricing</h2>
        <button onClick={addBlank} className="min-h-[40px] rounded-md bg-red-600 px-3 text-sm text-white">＋ Add service</button>
      </div>
      <p className="mb-3 text-sm text-neutral-500">Your menu with prices per vehicle size. Used by the quote builder on each contact.</p>
      {note && <p className="mb-2 text-xs text-neutral-500">{note}</p>}
      <ul className="space-y-2">
        {items.map((s) => (
          <li key={s.id} className="rounded-lg border border-neutral-200 p-3">
            {editing === s.id ? (
              <div className="space-y-2">
                <input value={s.name} onChange={(e) => patchLocal(s.id, { name: e.target.value })} placeholder="Service name" className="min-h-[40px] w-full rounded-md border border-neutral-300 px-2 text-sm" />
                <input value={s.description ?? ""} onChange={(e) => patchLocal(s.id, { description: e.target.value })} placeholder="Short description" className="min-h-[40px] w-full rounded-md border border-neutral-300 px-2 text-sm" />
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {SIZE_CLASSES.map((size) => (
                    <label key={size} className="text-xs capitalize text-neutral-500">{size}
                      <div className="mt-0.5 flex items-center rounded-md border border-neutral-300 px-2">
                        <span className="text-neutral-400">$</span>
                        <input inputMode="decimal" value={((s.size_pricing[size] ?? 0) / 100) || ""} onChange={(e) => setPrice(s.id, size, e.target.value)} placeholder="0" className="min-h-[40px] w-full px-1 text-sm outline-none" />
                      </div>
                    </label>
                  ))}
                </div>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={s.active} onChange={(e) => patchLocal(s.id, { active: e.target.checked })} /> Active (shown in quote builder)</label>
                <div className="flex gap-2">
                  <button onClick={() => save(s)} className="min-h-[40px] flex-1 rounded-md bg-red-600 px-3 text-sm text-white">Save</button>
                  <button onClick={() => { setEditing(null); load(); }} className="min-h-[40px] rounded-md bg-neutral-200 px-3 text-sm">Cancel</button>
                  <button onClick={() => del(s.id)} className="min-h-[40px] rounded-md bg-neutral-100 px-3 text-sm text-red-600">Delete</button>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-sm font-medium">{s.name}{!s.active && <span className="ml-2 text-xs text-neutral-400">(inactive)</span>}</div>
                  <div className="text-xs text-neutral-500">
                    {SIZE_CLASSES.filter((z) => s.size_pricing[z]).slice(0, 3).map((z) => `${z} ${money(s.size_pricing[z]!)}`).join(" · ") || `from ${money(s.base_price_cents)}`}
                  </div>
                </div>
                <button onClick={() => setEditing(s.id)} className="min-h-[40px] shrink-0 rounded-md bg-neutral-100 px-3 text-sm">Edit</button>
              </div>
            )}
          </li>
        ))}
        {items.length === 0 && <li className="text-sm text-neutral-400">No services yet — add your first one.</li>}
      </ul>
    </section>
  );
}

export default function Settings() {
  const [template, setTemplate] = useState("");
  const [brand, setBrand] = useState("");
  const [feedToken, setFeedToken] = useState("");
  const [savedNote, setSavedNote] = useState("");
  const [brandNote, setBrandNote] = useState("");
  const [copied, setCopied] = useState(false);
  const [copiedKey, setCopiedKey] = useState("");
  const [labels, setLabels] = useState<Label[]>([]);
  const [newLabel, setNewLabel] = useState({ label: "", color: "#ef4444" });
  const [hours, setHours] = useState(DEFAULT_HOURS);
  const [hoursNote, setHoursNote] = useState("");
  const [reviewUrl, setReviewUrl] = useState("");
  const [reviewAuto, setReviewAuto] = useState(false);
  const [reviewNote, setReviewNote] = useState("");
  const [mc, setMc] = useState({ enabled: true, forward: "", timeout: "20", body: "", cooldown: "4", notifyEnabled: true, notifyNumber: "" });
  const [mcNote, setMcNote] = useState("");
  const [pay, setPay] = useState({ enabled: true, percent: "25", allowFull: true });
  const [payNote, setPayNote] = useState("");
  const [integrations, setIntegrations] = useState<{ stripe?: boolean; stripe_webhook?: boolean }>({});

  function loadLabels() { api<{ items: Label[] }>("/api/labels").then((r) => setLabels(r.items)).catch(() => {}); }

  useEffect(() => {
    api<{ settings: Record<string, string> }>("/api/settings")
      .then((r) => {
        setTemplate(r.settings.sms_template ?? DEFAULT_TEMPLATE);
        setBrand(r.settings.brand_brief ?? "");
        setFeedToken(r.settings.ics_feed_token ?? "");
        if (r.settings.business_hours) { try { setHours({ ...DEFAULT_HOURS, ...JSON.parse(r.settings.business_hours) }); } catch { /* keep default */ } }
        setReviewUrl(r.settings.review_url ?? "");
        setReviewAuto(r.settings.review_auto === "1");
        setMc({
          enabled: (r.settings.missed_call_enabled ?? "1") === "1",
          forward: r.settings.owner_forward_number ?? "",
          timeout: r.settings.missed_call_dial_timeout ?? "20",
          body: r.settings.missed_call_text_body ?? DEFAULT_MISSED_BODY,
          cooldown: r.settings.missed_call_cooldown_hours ?? "4",
          notifyEnabled: (r.settings.owner_notify_enabled ?? "1") === "1",
          notifyNumber: r.settings.owner_notify_number ?? "",
        });
        setPay({
          enabled: (r.settings.payments_enabled ?? "1") === "1",
          percent: r.settings.deposit_percent ?? "25",
          allowFull: (r.settings.deposit_allow_full ?? "1") === "1",
        });
      })
      .catch(() => setTemplate(DEFAULT_TEMPLATE));
    loadLabels();
    api<{ stripe: boolean; stripe_webhook: boolean }>("/api/settings/integrations").then(setIntegrations).catch(() => {});
  }, []);

  async function savePayments() {
    setPayNote("");
    const pct = String(Math.min(100, Math.max(0, Number.parseInt(pay.percent, 10) || 0)));
    const pairs: Array<[string, string]> = [
      ["payments_enabled", pay.enabled ? "1" : "0"],
      ["deposit_percent", pct],
      ["deposit_allow_full", pay.allowFull ? "1" : "0"],
    ];
    try {
      for (const [key, value] of pairs) await api("/api/settings", { method: "PUT", body: JSON.stringify({ key, value }) });
      setPayNote("Saved.");
    } catch { setPayNote("Couldn't save — try again."); }
  }

  async function saveHours() {
    setHoursNote("");
    try { await api("/api/settings", { method: "PUT", body: JSON.stringify({ key: "business_hours", value: JSON.stringify(hours) }) }); setHoursNote("Saved."); }
    catch { setHoursNote("Couldn't save — try again."); }
  }
  async function saveReview() {
    setReviewNote("");
    try {
      await api("/api/settings", { method: "PUT", body: JSON.stringify({ key: "review_url", value: reviewUrl }) });
      await api("/api/settings", { method: "PUT", body: JSON.stringify({ key: "review_auto", value: reviewAuto ? "1" : "0" }) });
      setReviewNote("Saved.");
    } catch { setReviewNote("Couldn't save — try again."); }
  }
  async function saveMissedCall() {
    setMcNote("");
    const pairs: Array<[string, string]> = [
      ["missed_call_enabled", mc.enabled ? "1" : "0"],
      ["owner_forward_number", mc.forward.trim()],
      ["missed_call_dial_timeout", String(Number.parseInt(mc.timeout, 10) || 20)],
      ["missed_call_text_body", mc.body],
      ["missed_call_cooldown_hours", String(Number.parseInt(mc.cooldown, 10) || 4)],
      ["owner_notify_enabled", mc.notifyEnabled ? "1" : "0"],
      ["owner_notify_number", mc.notifyNumber.trim()],
    ];
    try {
      for (const [key, value] of pairs) {
        await api("/api/settings", { method: "PUT", body: JSON.stringify({ key, value }) });
      }
      setMcNote("Saved.");
    } catch { setMcNote("Couldn't save — try again."); }
  }

  async function addLabel() {
    const name = newLabel.label.trim();
    if (!name) return;
    const key = name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40) || `l${Date.now()}`;
    try { await api("/api/labels", { method: "POST", body: JSON.stringify({ key, label: name, color: newLabel.color }) }); setNewLabel({ label: "", color: "#ef4444" }); loadLabels(); }
    catch { /* ignore (dup) */ }
  }
  async function deleteLabel(key: string) {
    await api(`/api/labels/${key}`, { method: "DELETE" });
    loadLabels();
  }

  async function saveTemplate() {
    setSavedNote("");
    try {
      await api("/api/settings", { method: "PUT", body: JSON.stringify({ key: "sms_template", value: template }) });
      setSavedNote("Saved.");
    } catch { setSavedNote("Couldn't save — try again."); }
  }

  async function saveBrand() {
    setBrandNote("");
    try {
      await api("/api/settings", { method: "PUT", body: JSON.stringify({ key: "brand_brief", value: brand }) });
      setBrandNote("Saved.");
    } catch { setBrandNote("Couldn't save — try again."); }
  }

  async function generateFeed() {
    const token = crypto.randomUUID().replace(/-/g, "");
    try {
      await api("/api/settings", { method: "PUT", body: JSON.stringify({ key: "ics_feed_token", value: token }) });
      setFeedToken(token);
    } catch { /* ignore */ }
  }

  const feedUrl = feedToken ? `${location.origin}/api/calendar/${feedToken}.ics` : "";
  const bookingUrl = `${location.origin}/book`;
  const embedCode = `<iframe src="${bookingUrl}" title="Book BH Car Detailing" width="100%" height="900" style="border:0;max-width:480px;margin:0 auto;display:block" loading="lazy"></iframe>`;
  const chatSnippet = `<script src="${location.origin}/api/widget.js" async></script>`;
  function copyText(key: string, text: string) {
    navigator.clipboard?.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(""), 1500);
  }

  return (
    <div className="p-4 md:p-8">
      <h1 className="mb-4 text-2xl font-semibold">Settings</h1>

      <div className="max-w-xl space-y-6">
        <Link to="/sequences" className="flex items-center justify-between rounded-xl bg-white p-5 shadow-sm hover:shadow">
          <div>
            <div className="font-medium">Email sequences</div>
            <div className="text-sm text-neutral-500">Automated follow-up emails for new leads.</div>
          </div>
          <span className="text-red-600">›</span>
        </Link>

        <ServicesManager />

        <section className="rounded-xl bg-white p-5 shadow-sm">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="font-medium">Payments & deposits</h2>
            <span className={`rounded-full px-2 py-0.5 text-xs ${integrations.stripe ? "bg-green-100 text-green-700" : "bg-neutral-200 text-neutral-600"}`}>
              {integrations.stripe ? "Stripe connected" : "Stripe not connected"}
            </span>
          </div>
          <p className="mb-3 text-sm text-neutral-500">Collect deposits on accepted quotes via Stripe Checkout. Customers pay on Stripe's secure page — no card data touches the CRM.</p>
          {!integrations.stripe && (
            <div className="mb-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
              To turn payments on, add your Stripe keys as Worker secrets: <code>STRIPE_SECRET_KEY</code> and <code>STRIPE_WEBHOOK_SECRET</code>. Until then, the Pay buttons stay hidden on quotes.
            </div>
          )}
          {integrations.stripe && !integrations.stripe_webhook && (
            <div className="mb-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
              Add <code>STRIPE_WEBHOOK_SECRET</code> too, and point a Stripe webhook at <code>{location.origin}/api/stripe/webhook</code> (event: <code>checkout.session.completed</code>) so payments get recorded.
            </div>
          )}
          <label className="mb-3 flex items-center gap-2 text-sm">
            <input type="checkbox" checked={pay.enabled} onChange={(e) => setPay({ ...pay, enabled: e.target.checked })} /> Show payment buttons on quotes
          </label>
          <div className="mb-3 flex flex-wrap gap-4">
            <label className="text-sm">Deposit %
              <input type="number" min={0} max={100} value={pay.percent} onChange={(e) => setPay({ ...pay, percent: e.target.value })} className="mt-1 min-h-[44px] w-24 rounded-md border border-neutral-300 px-2 text-sm" />
            </label>
            <label className="flex items-end gap-2 text-sm pb-2">
              <input type="checkbox" checked={pay.allowFull} onChange={(e) => setPay({ ...pay, allowFull: e.target.checked })} /> Also let them pay in full
            </label>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={savePayments} className="min-h-[44px] rounded-md bg-red-600 px-4 text-sm text-white">Save</button>
            {payNote && <span className="text-xs text-neutral-500">{payNote}</span>}
          </div>
        </section>

        <section className="rounded-xl bg-white p-5 shadow-sm">
          <h2 className="mb-2 font-medium">Website chat widget</h2>
          <p className="mb-3 text-sm text-neutral-500">Adds a chat bubble to your website. Visitors leave their name, phone, and message — it becomes a new lead in your CRM and shows up in the Inbox to text back.</p>
          <p className="mb-2 text-xs text-neutral-500">Paste this before <code>&lt;/body&gt;</code> on bhcardetails.com:</p>
          <textarea readOnly value={chatSnippet} rows={2} onFocus={(e) => e.currentTarget.select()} className="w-full rounded-md border border-neutral-300 bg-neutral-50 px-3 py-2 font-mono text-xs" />
          <button onClick={() => copyText("chat", chatSnippet)} className="mt-2 min-h-[44px] rounded-md bg-red-600 px-4 text-sm text-white">{copiedKey === "chat" ? "Copied!" : "Copy chat code"}</button>
        </section>

        <section className="rounded-xl bg-white p-5 shadow-sm">
          <h2 className="mb-2 font-medium">Text message template</h2>
          <p className="mb-3 text-sm text-neutral-500">Pre-filled when you tap “Text” on a lead. Use <code>{"{first_name}"}</code> to drop in their name.</p>
          <textarea value={template} onChange={(e) => setTemplate(e.target.value)} rows={4} className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-red-600" />
          <div className="mt-2 flex items-center gap-3">
            <button onClick={saveTemplate} className="min-h-[44px] rounded-md bg-red-600 px-4 text-sm text-white">Save template</button>
            {savedNote && <span className="text-xs text-neutral-500">{savedNote}</span>}
          </div>
        </section>

        <section className="rounded-xl bg-white p-5 shadow-sm">
          <h2 className="mb-2 font-medium">Missed-call text-back</h2>
          <p className="mb-3 text-sm text-neutral-500">When someone calls your CRM number and you don't pick up, we auto-text them and log the lead. Rings your cell first.</p>
          <label className="mb-3 flex items-center gap-2 text-sm">
            <input type="checkbox" checked={mc.enabled} onChange={(e) => setMc({ ...mc, enabled: e.target.checked })} /> Enable missed-call text-back
          </label>
          <label className="mb-2 block text-sm">Your cell (rings first)
            <input value={mc.forward} onChange={(e) => setMc({ ...mc, forward: e.target.value })} placeholder="+1305…" className="mt-1 min-h-[44px] w-full rounded-md border border-neutral-300 px-3 text-sm" />
          </label>
          <div className="mb-2 flex gap-3">
            <label className="text-sm">Ring seconds
              <input type="number" min={5} max={60} value={mc.timeout} onChange={(e) => setMc({ ...mc, timeout: e.target.value })} className="mt-1 min-h-[44px] w-24 rounded-md border border-neutral-300 px-2 text-sm" />
            </label>
            <label className="text-sm">Cooldown (hours)
              <input type="number" min={0} value={mc.cooldown} onChange={(e) => setMc({ ...mc, cooldown: e.target.value })} className="mt-1 min-h-[44px] w-24 rounded-md border border-neutral-300 px-2 text-sm" />
            </label>
          </div>
          <label className="mb-2 block text-sm">Auto-text message
            <textarea value={mc.body} onChange={(e) => setMc({ ...mc, body: e.target.value })} rows={4} className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm" />
          </label>
          <label className="mb-2 flex items-center gap-2 text-sm">
            <input type="checkbox" checked={mc.notifyEnabled} onChange={(e) => setMc({ ...mc, notifyEnabled: e.target.checked })} /> Text me when I miss a call
          </label>
          <label className="mb-3 block text-sm">Notify this number (defaults to your cell)
            <input value={mc.notifyNumber} onChange={(e) => setMc({ ...mc, notifyNumber: e.target.value })} placeholder="+1305…" className="mt-1 min-h-[44px] w-full rounded-md border border-neutral-300 px-3 text-sm" />
          </label>
          <div className="flex items-center gap-3">
            <button onClick={saveMissedCall} className="min-h-[44px] rounded-md bg-red-600 px-4 text-sm text-white">Save</button>
            {mcNote && <span className="text-xs text-neutral-500">{mcNote}</span>}
          </div>
        </section>

        <section className="rounded-xl bg-white p-5 shadow-sm">
          <h2 className="mb-2 font-medium">Brand brain</h2>
          <p className="mb-3 text-sm text-neutral-500">Tell the AI your voice, services, offers, and pricing style. It uses this to summarize new leads and draft replies. (Drafting activates once your Anthropic key is added.)</p>
          <textarea value={brand} onChange={(e) => setBrand(e.target.value)} rows={5} placeholder="e.g. We're a friendly mobile detailing crew in Miami. Ceramic coatings from $750, full details from $150. Always quote fast and offer a weekday discount…" className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-red-600" />
          <div className="mt-2 flex items-center gap-3">
            <button onClick={saveBrand} className="min-h-[44px] rounded-md bg-red-600 px-4 text-sm text-white">Save brand brief</button>
            {brandNote && <span className="text-xs text-neutral-500">{brandNote}</span>}
          </div>
        </section>

        <section className="rounded-xl bg-white p-5 shadow-sm">
          <h2 className="mb-2 font-medium">Labels</h2>
          <p className="mb-3 text-sm text-neutral-500">Colored labels classify contacts and double as email lists (select a label in Contacts → Email this list).</p>
          <div className="mb-3 flex flex-wrap gap-2">
            {labels.map((l) => (
              <span key={l.key} className="flex items-center gap-1 rounded-full px-2 py-1 text-xs text-white" style={{ backgroundColor: l.color }}>
                {l.label}
                <button onClick={() => deleteLabel(l.key)} className="opacity-80 hover:opacity-100">✕</button>
              </span>
            ))}
            {labels.length === 0 && <span className="text-sm text-neutral-400">No labels yet.</span>}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input value={newLabel.label} onChange={(e) => setNewLabel({ ...newLabel, label: e.target.value })} placeholder="e.g. VIP" className="min-h-[44px] rounded-md border border-neutral-300 px-3 text-sm" />
            <input type="color" value={newLabel.color} onChange={(e) => setNewLabel({ ...newLabel, color: e.target.value })} className="h-11 w-12 rounded-md border border-neutral-300" />
            <button onClick={addLabel} className="min-h-[44px] rounded-md bg-red-600 px-4 text-sm text-white">Add label</button>
          </div>
        </section>

        <section className="rounded-xl bg-white p-5 shadow-sm">
          <h2 className="mb-2 font-medium">Booking availability</h2>
          <p className="mb-3 text-sm text-neutral-500">Powers your public booking page at <code>/book</code>. Customers see open slots based on these hours minus your existing jobs.</p>
          <div className="mb-3 flex flex-wrap gap-1">
            {DAYS.map((d, i) => (
              <button key={i} onClick={() => setHours((h) => ({ ...h, days: h.days.includes(i) ? h.days.filter((x) => x !== i) : [...h.days, i].sort() }))}
                className={`min-h-[40px] rounded-md px-3 text-sm ${hours.days.includes(i) ? "bg-red-600 text-white" : "bg-neutral-200 text-neutral-700"}`}>{d}</button>
            ))}
          </div>
          <div className="mb-3 flex flex-wrap gap-3 text-sm">
            <label className="flex items-center gap-2">Open <input type="time" value={hours.start} onChange={(e) => setHours({ ...hours, start: e.target.value })} className="min-h-[44px] rounded-md border border-neutral-300 px-2" /></label>
            <label className="flex items-center gap-2">Close <input type="time" value={hours.end} onChange={(e) => setHours({ ...hours, end: e.target.value })} className="min-h-[44px] rounded-md border border-neutral-300 px-2" /></label>
            <label className="flex items-center gap-2">Slot (min) <input type="number" min={30} step={30} value={hours.slot_min} onChange={(e) => setHours({ ...hours, slot_min: Number(e.target.value) })} className="min-h-[44px] w-20 rounded-md border border-neutral-300 px-2" /></label>
            <label className="flex items-center gap-2">Buffer (min) <input type="number" min={0} step={15} value={hours.buffer_min} onChange={(e) => setHours({ ...hours, buffer_min: Number(e.target.value) })} className="min-h-[44px] w-20 rounded-md border border-neutral-300 px-2" /></label>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={saveHours} className="min-h-[44px] rounded-md bg-red-600 px-4 text-sm text-white">Save hours</button>
            <a href="/book" target="_blank" rel="noreferrer" className="text-sm text-red-600 hover:underline">Open booking page ↗</a>
            {hoursNote && <span className="text-xs text-neutral-500">{hoursNote}</span>}
          </div>
        </section>

        <section className="rounded-xl bg-white p-5 shadow-sm">
          <h2 className="mb-2 font-medium">Share your booking page</h2>
          <p className="mb-3 text-sm text-neutral-500">Send this link in a text or email so customers can book a time themselves — or embed it right on your website.</p>

          <label className="mb-1 block text-sm font-medium text-neutral-700">Sendable link</label>
          <div className="mb-4 flex items-center gap-2">
            <input readOnly value={bookingUrl} className="min-w-0 flex-1 rounded-md border border-neutral-300 px-3 py-2 text-sm" />
            <button onClick={() => copyText("link", bookingUrl)} className="min-h-[44px] shrink-0 rounded-md bg-neutral-900 px-3 text-sm text-white">{copiedKey === "link" ? "Copied" : "Copy"}</button>
            <a href={bookingUrl} target="_blank" rel="noreferrer" className="min-h-[44px] shrink-0 rounded-md bg-neutral-200 px-3 py-2 text-sm">Open ↗</a>
          </div>

          <label className="mb-1 block text-sm font-medium text-neutral-700">Embed on your website</label>
          <p className="mb-2 text-xs text-neutral-500">Paste this HTML where you want the booking form to appear on bhcardetails.com.</p>
          <textarea readOnly value={embedCode} rows={4} onFocus={(e) => e.currentTarget.select()} className="w-full rounded-md border border-neutral-300 bg-neutral-50 px-3 py-2 font-mono text-xs" />
          <button onClick={() => copyText("embed", embedCode)} className="mt-2 min-h-[44px] rounded-md bg-red-600 px-4 text-sm text-white">{copiedKey === "embed" ? "Copied!" : "Copy embed code"}</button>
        </section>

        <section className="rounded-xl bg-white p-5 shadow-sm">
          <h2 className="mb-2 font-medium">Review requests</h2>
          <p className="mb-3 text-sm text-neutral-500">Paste your Google review link. Send it from any completed job, or auto-send when a job is marked complete. (Sends via text/email once those are live.)</p>
          <input value={reviewUrl} onChange={(e) => setReviewUrl(e.target.value)} placeholder="https://g.page/r/…/review" className="mb-2 min-h-[44px] w-full rounded-md border border-neutral-300 px-3 text-sm" />
          <label className="mb-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={reviewAuto} onChange={(e) => setReviewAuto(e.target.checked)} /> Auto-request a review when a job is marked completed</label>
          <div className="flex items-center gap-3">
            <button onClick={saveReview} className="min-h-[44px] rounded-md bg-red-600 px-4 text-sm text-white">Save</button>
            {reviewNote && <span className="text-xs text-neutral-500">{reviewNote}</span>}
          </div>
        </section>

        <section className="rounded-xl bg-white p-5 shadow-sm">
          <h2 className="mb-2 font-medium">iPhone calendar sync</h2>
          <p className="mb-3 text-sm text-neutral-500">Subscribe once and every scheduled job shows on your iPhone calendar automatically (one-way, read-only).</p>
          {feedUrl ? (
            <>
              <div className="mb-2 flex items-center gap-2">
                <input readOnly value={feedUrl} className="min-w-0 flex-1 rounded-md border border-neutral-300 px-3 py-2 text-xs" />
                <button onClick={() => { navigator.clipboard?.writeText(feedUrl); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
                  className="min-h-[44px] shrink-0 rounded-md bg-neutral-900 px-3 text-sm text-white">{copied ? "Copied" : "Copy"}</button>
              </div>
              <ol className="list-decimal space-y-1 pl-5 text-sm text-neutral-600">
                <li>iPhone <strong>Calendar</strong> app → <strong>Calendars</strong> → <strong>Add Calendar</strong> → <strong>Add Subscription Calendar</strong>.</li>
                <li>Paste the link above → <strong>Subscribe</strong>.</li>
              </ol>
              <button onClick={generateFeed} className="mt-3 text-xs text-neutral-400 hover:text-red-600">Regenerate link (invalidates the old one)</button>
            </>
          ) : (
            <button onClick={generateFeed} className="min-h-[44px] rounded-md bg-red-600 px-4 text-sm text-white">Generate my calendar link</button>
          )}
        </section>
      </div>
    </div>
  );
}
