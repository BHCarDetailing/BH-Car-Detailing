import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import type { Label } from "../types";

const DEFAULT_TEMPLATE = "Hi {first_name}, this is BH Car Detailing — thanks for reaching out! Happy to get you a quote. When works for a quick call or text?";
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DEFAULT_HOURS = { days: [1, 2, 3, 4, 5, 6], start: "09:00", end: "18:00", slot_min: 120, buffer_min: 30 };
const DEFAULT_MISSED_BODY = "Hey, this is BH Car Detailing - sorry we missed your call! Reply here with what you need and we'll be in touch.\nIf you'd like to book on your own our website is bhcardetails.com";

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
      })
      .catch(() => setTemplate(DEFAULT_TEMPLATE));
    loadLabels();
  }, []);

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
