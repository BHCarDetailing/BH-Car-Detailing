import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";

const DEFAULT_TEMPLATE = "Hi {first_name}, this is BH Car Detailing — thanks for reaching out! Happy to get you a quote. When works for a quick call or text?";

export default function Settings() {
  const [template, setTemplate] = useState("");
  const [brand, setBrand] = useState("");
  const [feedToken, setFeedToken] = useState("");
  const [savedNote, setSavedNote] = useState("");
  const [brandNote, setBrandNote] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    api<{ settings: Record<string, string> }>("/api/settings")
      .then((r) => {
        setTemplate(r.settings.sms_template ?? DEFAULT_TEMPLATE);
        setBrand(r.settings.brand_brief ?? "");
        setFeedToken(r.settings.ics_feed_token ?? "");
      })
      .catch(() => setTemplate(DEFAULT_TEMPLATE));
  }, []);

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
          <h2 className="mb-2 font-medium">Brand brain</h2>
          <p className="mb-3 text-sm text-neutral-500">Tell the AI your voice, services, offers, and pricing style. It uses this to summarize new leads and draft replies. (Drafting activates once your Anthropic key is added.)</p>
          <textarea value={brand} onChange={(e) => setBrand(e.target.value)} rows={5} placeholder="e.g. We're a friendly mobile detailing crew in Miami. Ceramic coatings from $750, full details from $150. Always quote fast and offer a weekday discount…" className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-red-600" />
          <div className="mt-2 flex items-center gap-3">
            <button onClick={saveBrand} className="min-h-[44px] rounded-md bg-red-600 px-4 text-sm text-white">Save brand brief</button>
            {brandNote && <span className="text-xs text-neutral-500">{brandNote}</span>}
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
