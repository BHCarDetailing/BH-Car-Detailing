import { useEffect, useState } from "react";
import { api } from "../api";

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function Book() {
  const [service, setService] = useState("Full detail");
  const [date, setDate] = useState(todayStr());
  const [slots, setSlots] = useState<string[]>([]);
  const [slot, setSlot] = useState("");
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [website, setWebsite] = useState(""); // honeypot
  const [optIn, setOptIn] = useState(false);
  const [mktIn, setMktIn] = useState(false);
  const [mountedAt] = useState(() => Date.now());
  const [done, setDone] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    setSlot(""); setSlots([]); setLoading(true);
    api<{ slots: string[] }>(`/api/book/availability?date=${date}`)
      .then((r) => setSlots(r.slots))
      .catch(() => setSlots([]))
      .finally(() => setLoading(false));
  }, [date]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    if (!slot) { setErr("Pick a time."); return; }
    if (!phone.trim()) { setErr("Add a phone number."); return; }
    try {
      const res = await fetch("/api/book", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, phone, email, address, service, slot_start: slot, website, ts: mountedAt, sms_opt_in: optIn, marketing_opt_in: mktIn }),
      });
      if (res.status === 409) { setErr("That time was just taken — pick another."); return; }
      if (!res.ok) { setErr("Something went wrong — try again."); return; }
      setDone(true);
    } catch { setErr("Something went wrong — try again."); }
  }

  if (done) return (
    <div className="mx-auto max-w-md p-6 text-center">
      <h1 className="mb-2 text-2xl font-semibold text-neutral-900">You're booked! 🎉</h1>
      <p className="text-neutral-600">We've got you down for {service} on {new Date(slot).toLocaleString()}. We'll be in touch to confirm.</p>
    </div>
  );

  return (
    <div className="mx-auto max-w-md p-4 sm:p-6">
      <h1 className="mb-1 text-2xl font-semibold text-neutral-900">Book your detail</h1>
      <p className="mb-5 text-sm text-neutral-500">BH Car Detailing — Miami / Fort Lauderdale</p>

      <form onSubmit={submit} className="space-y-4">
        <label className="block text-sm">
          <span className="mb-1 block text-neutral-600">Service</span>
          <select value={service} onChange={(e) => setService(e.target.value)} className="min-h-[44px] w-full rounded-md border border-neutral-300 px-3">
            {["Full detail", "Interior detail", "Exterior detail", "Ceramic coating", "Wash & wax"].map((s) => <option key={s}>{s}</option>)}
          </select>
        </label>

        <label className="block text-sm">
          <span className="mb-1 block text-neutral-600">Date</span>
          <input type="date" min={todayStr()} value={date} onChange={(e) => setDate(e.target.value)} className="min-h-[44px] w-full rounded-md border border-neutral-300 px-3" />
        </label>

        <div>
          <span className="mb-1 block text-sm text-neutral-600">Available times</span>
          {loading ? <p className="text-sm text-neutral-400">Loading…</p> :
            slots.length === 0 ? <p className="text-sm text-neutral-400">No open times that day — try another date.</p> :
              <div className="flex flex-wrap gap-2">
                {slots.map((s) => (
                  <button type="button" key={s} onClick={() => setSlot(s)}
                    className={`min-h-[44px] rounded-md px-3 text-sm ${slot === s ? "bg-red-600 text-white" : "bg-neutral-100 text-neutral-800"}`}>
                    {new Date(s).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                  </button>
                ))}
              </div>}
        </div>

        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" className="min-h-[44px] w-full rounded-md border border-neutral-300 px-3 text-sm" />
        <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" placeholder="Phone number" className="min-h-[44px] w-full rounded-md border border-neutral-300 px-3 text-sm" />
        <input value={email} onChange={(e) => setEmail(e.target.value)} inputMode="email" placeholder="Email (optional)" className="min-h-[44px] w-full rounded-md border border-neutral-300 px-3 text-sm" />
        <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Where should we come? (address)" className="min-h-[44px] w-full rounded-md border border-neutral-300 px-3 text-sm" />
        <input value={website} onChange={(e) => setWebsite(e.target.value)} tabIndex={-1} autoComplete="off" className="hidden" aria-hidden="true" />

        <div className="space-y-2 text-xs leading-relaxed text-neutral-500">
          <label className="flex items-start gap-2">
            <input type="checkbox" checked={optIn} onChange={(e) => setOptIn(e.target.checked)} className="mt-0.5" />
            <span>Yes, text me about my appointment and reminders (service messages).</span>
          </label>
          <label className="flex items-start gap-2">
            <input type="checkbox" checked={mktIn} onChange={(e) => setMktIn(e.target.checked)} className="mt-0.5" />
            <span>Yes, also send me occasional offers &amp; promotions from BH Car Detailing. (Optional — not required to book.)</span>
          </label>
          <p className="text-neutral-400">By checking a box you agree to receive the selected texts from BH Car Detailing at the number provided. Consent is not a condition of purchase. Msg &amp; data rates may apply, frequency varies, reply STOP to opt out, HELP for help. See <a href="https://bhcardetails.com/terms.html" target="_blank" rel="noreferrer" className="text-red-600 underline">Terms</a> &amp; <a href="https://bhcardetails.com/privacy-policy.html" target="_blank" rel="noreferrer" className="text-red-600 underline">Privacy</a>.</p>
        </div>

        {err && <p className="text-sm text-red-600">{err}</p>}
        <button className="min-h-[48px] w-full rounded-md bg-red-600 px-4 font-medium text-white">Book it</button>
      </form>
    </div>
  );
}
