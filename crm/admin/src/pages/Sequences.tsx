import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "../api";

interface Step { delay_hours: number; subject: string; body_text: string }
interface Sequence { id: string; name: string; status: string; trigger: string; step_count: number; active_count: number }

const BLANK_STEP: Step = { delay_hours: 24, subject: "", body_text: "" };

export default function Sequences() {
  const [items, setItems] = useState<Sequence[]>([]);
  const [editing, setEditing] = useState<{ id?: string; name: string; trigger: string; steps: Step[] } | null>(null);
  const [testTo, setTestTo] = useState("info@bhcardetails.com");
  const [testMsg, setTestMsg] = useState("");
  const [testOk, setTestOk] = useState(false);
  const [testBusy, setTestBusy] = useState(false);

  async function sendTest() {
    setTestBusy(true); setTestMsg(""); setTestOk(false);
    try {
      await api("/api/email/test", { method: "POST", body: JSON.stringify({ to: testTo }) });
      setTestOk(true); setTestMsg(`Sent to ${testTo} — check the inbox (and spam folder).`);
    } catch (e) {
      if (e instanceof ApiError && e.status === 503) setTestMsg("Email isn't connected yet — set RESEND_API_KEY as a Worker secret.");
      else if (e instanceof ApiError && e.status === 400) setTestMsg("Enter a valid email address.");
      else setTestMsg("Send failed — check your Resend domain is verified (Resend → Logs shows why).");
    } finally { setTestBusy(false); }
  }

  const load = useCallback(() => {
    api<{ items: Sequence[] }>("/api/sequences").then((r) => setItems(r.items)).catch(() => {});
  }, []);
  useEffect(load, [load]);

  function newSequence() {
    setEditing({ name: "", trigger: "manual", steps: [{ delay_hours: 0, subject: "", body_text: "" }] });
  }

  async function openEdit(id: string) {
    const s = await api<Sequence & { steps: Step[] }>(`/api/sequences/${id}`);
    setEditing({ id, name: s.name, trigger: s.trigger, steps: s.steps.length ? s.steps : [{ ...BLANK_STEP, delay_hours: 0 }] });
  }

  async function save() {
    if (!editing || !editing.name.trim()) return;
    const body = JSON.stringify({ name: editing.name, trigger: editing.trigger, steps: editing.steps });
    if (editing.id) await api(`/api/sequences/${editing.id}`, { method: "PATCH", body });
    else await api("/api/sequences", { method: "POST", body });
    setEditing(null); load();
  }

  async function toggle(s: Sequence) {
    await api(`/api/sequences/${s.id}`, { method: "PATCH", body: JSON.stringify({ status: s.status === "active" ? "draft" : "active" }) });
    load();
  }

  async function remove(id: string) {
    await api(`/api/sequences/${id}`, { method: "DELETE" });
    load();
  }

  return (
    <div className="p-4 md:p-8">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Email sequences</h1>
        <button onClick={newSequence} className="min-h-[44px] rounded-md bg-red-600 px-4 text-sm text-white">＋ New sequence</button>
      </div>

      {/* One-click delivery test — sends immediately, no cron/quiet-hours wait */}
      <div className="mb-6 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-steel-200">
        <h2 className="text-sm font-semibold text-graphite-950">Send a test email</h2>
        <p className="mb-3 text-xs text-chrome-400">Fires immediately so you can confirm delivery. Uses your connected Resend sender.</p>
        <div className="flex flex-wrap gap-2">
          <input type="email" value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="you@email.com"
            className="min-w-[200px] flex-1 rounded-lg border border-steel-200 px-3 py-2 text-sm outline-none focus:border-red-400 focus:ring-2 focus:ring-red-100" />
          <button onClick={sendTest} disabled={testBusy || !testTo.trim()}
            className="inline-flex min-h-[40px] items-center rounded-lg bg-gradient-to-b from-red-500 to-red-600 px-4 text-sm font-medium text-white shadow-sm ring-1 ring-inset ring-white/10 hover:from-red-500 hover:to-red-500 disabled:opacity-50">
            {testBusy ? "Sending…" : "Send test"}
          </button>
        </div>
        {testMsg && <p className={`mt-2 text-sm ${testOk ? "text-emerald-600" : "text-amber-600"}`}>{testMsg}</p>}
      </div>

      {items.length === 0 ? (
        <p className="text-sm text-neutral-500">No sequences yet. Create one to automatically follow up with leads by email. (Emails log safely until Resend email is connected.)</p>
      ) : (
        <ul className="space-y-2">
          {items.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-white p-4 shadow-sm">
              <div className="min-w-0">
                <div className="font-medium">{s.name}</div>
                <div className="text-xs text-neutral-500">{s.step_count} step{s.step_count === 1 ? "" : "s"} · {s.active_count} active · trigger: {s.trigger}</div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button onClick={() => toggle(s)} className={`min-h-[44px] rounded-md px-3 text-sm ${s.status === "active" ? "bg-green-100 text-green-800" : "bg-neutral-200 text-neutral-700"}`}>{s.status === "active" ? "Active" : "Draft"}</button>
                <button onClick={() => openEdit(s.id)} className="min-h-[44px] rounded-md bg-neutral-900 px-3 text-sm text-white">Edit</button>
                <button onClick={() => remove(s.id)} className="min-h-[44px] rounded-md bg-neutral-100 px-3 text-sm text-neutral-500">Delete</button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {editing && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 md:items-center" onClick={() => setEditing(null)}>
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-5 md:rounded-2xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="mb-3 text-lg font-semibold">{editing.id ? "Edit sequence" : "New sequence"}</h2>
            <input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} placeholder="Sequence name" className="mb-2 min-h-[44px] w-full rounded-md border border-neutral-300 px-3 text-sm" />
            <label className="mb-1 block text-xs text-neutral-500">Trigger</label>
            <select value={editing.trigger} onChange={(e) => setEditing({ ...editing, trigger: e.target.value })} className="mb-4 min-h-[44px] w-full rounded-md border border-neutral-300 px-2 text-sm">
              <option value="manual">Manual (you enroll people)</option>
              <option value="stage:new">Automatic — every new lead</option>
            </select>

            <div className="space-y-3">
              {editing.steps.map((st, i) => (
                <div key={i} className="rounded-lg border border-neutral-200 p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-sm font-medium">Step {i + 1}</span>
                    {editing.steps.length > 1 && <button onClick={() => setEditing({ ...editing, steps: editing.steps.filter((_, j) => j !== i) })} className="text-xs text-neutral-400">Remove</button>}
                  </div>
                  <label className="text-xs text-neutral-500">Send after (hours{i === 0 ? " from enrollment" : " from previous step"})</label>
                  <input type="number" min={0} value={st.delay_hours} onChange={(e) => { const steps = [...editing.steps]; steps[i] = { ...st, delay_hours: Number(e.target.value) }; setEditing({ ...editing, steps }); }} className="mb-2 min-h-[44px] w-full rounded-md border border-neutral-300 px-3 text-sm" />
                  <input value={st.subject} onChange={(e) => { const steps = [...editing.steps]; steps[i] = { ...st, subject: e.target.value }; setEditing({ ...editing, steps }); }} placeholder="Subject" className="mb-2 min-h-[44px] w-full rounded-md border border-neutral-300 px-3 text-sm" />
                  <textarea value={st.body_text} onChange={(e) => { const steps = [...editing.steps]; steps[i] = { ...st, body_text: e.target.value }; setEditing({ ...editing, steps }); }} rows={3} placeholder="Message… use {first_name}" className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm" />
                </div>
              ))}
            </div>
            <button onClick={() => setEditing({ ...editing, steps: [...editing.steps, { ...BLANK_STEP }] })} className="mt-2 text-sm text-red-600">＋ Add step</button>

            <div className="mt-4 flex gap-2">
              <button onClick={save} className="min-h-[44px] flex-1 rounded-md bg-red-600 px-4 text-sm text-white">Save</button>
              <button onClick={() => setEditing(null)} className="min-h-[44px] rounded-md bg-neutral-200 px-4 text-sm">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
