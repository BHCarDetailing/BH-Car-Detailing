import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { fullName, money, type Job } from "../types";
import { addDays, dayLabel, isOnDay, startOfWeek, timeLabel, ymd, fmtDate } from "../lib/datetime";
import { PageHeader, Modal, Button, Field, Input } from "../components/ui";
import { ContactPicker } from "../components/ContactPicker";

// left accent bar + soft fill per job status
const STATUS_COLOR: Record<string, string> = {
  quoted: "border-amber-400 bg-amber-50 text-amber-900",
  scheduled: "border-sky-400 bg-sky-50 text-sky-900",
  in_progress: "border-violet-400 bg-violet-50 text-violet-900",
  completed: "border-emerald-400 bg-emerald-50 text-emerald-900",
  paid: "border-emerald-500 bg-emerald-50 text-emerald-900",
  cancelled: "border-neutral-300 bg-neutral-50 text-neutral-500",
  draft: "border-neutral-300 bg-neutral-50 text-neutral-600",
};

function JobChip({ job, onClick }: { job: Job; onClick: () => void }) {
  const paid = (job.amount_paid_cents ?? 0) > 0;
  return (
    <button onClick={onClick} className={`w-full rounded-md border-l-[3px] px-2 py-1.5 text-left text-xs shadow-sm transition hover:brightness-[0.98] ${STATUS_COLOR[job.status] ?? "border-neutral-300 bg-neutral-50"}`}>
      <div className="flex items-center justify-between gap-1">
        <span className="font-semibold">{job.scheduled_start ? timeLabel(job.scheduled_start) : "—"}</span>
        {paid && (
          <span title={Number(job.paid_in_full) === 1 ? "Paid in full" : "Deposit paid"} className="inline-flex items-center gap-0.5 rounded-full bg-emerald-100 px-1 text-[10px] font-semibold text-emerald-700">
            <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M5 13l4 4L19 7" /></svg>
            {Number(job.paid_in_full) === 1 ? "Paid" : "Dep"}
          </span>
        )}
      </div>
      <div className="truncate font-medium">{job.title}</div>
      <div className="flex items-center justify-between gap-1 opacity-70">
        <span className="truncate">{fullName({ first_name: job.first_name ?? null, last_name: job.last_name ?? null })}</span>
        {(job.price_cents ?? 0) > 0 && <span className="shrink-0 font-medium">{money(job.price_cents)}</span>}
      </div>
    </button>
  );
}

const NEW_EVENT = { title: "", contactId: "", customer: "", when: "", address: "", price: "", depositPaid: false, deposit: "" };

export default function Calendar() {
  const [weekStart, setWeekStart] = useState(() => startOfWeek());
  const [jobs, setJobs] = useState<Job[]>([]);
  const [selected, setSelected] = useState<Job | null>(null);
  const [when, setWhen] = useState("");
  const [msg, setMsg] = useState("");
  const [depInput, setDepInput] = useState("");
  const [newOpen, setNewOpen] = useState(false);
  const [ev, setEv] = useState(NEW_EVENT);
  const [evBusy, setEvBusy] = useState(false);
  const [evErr, setEvErr] = useState("");

  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  const load = useCallback(() => {
    const from = ymd(weekStart);
    const to = ymd(addDays(weekStart, 6));
    api<{ items: Job[] }>(`/api/jobs?from=${from}&to=${to}`).then((r) => setJobs(r.items)).catch(() => {});
  }, [weekStart]);
  useEffect(load, [load]);

  function openNew(day?: Date) {
    setEv({ ...NEW_EVENT, when: day ? `${ymd(day)}T09:00` : "" });
    setEvErr(""); setNewOpen(true);
  }
  async function saveEvent() {
    if (!ev.title.trim()) { setEvErr("Add a title."); return; }
    if (!ev.contactId) { setEvErr("Link a contact — search a name or add a new one."); return; }
    if (!ev.when) { setEvErr("Pick a date and time."); return; }
    const priceCents = Math.round((parseFloat(ev.price) || 0) * 100);
    const depositCents = Math.round((parseFloat(ev.deposit) || 0) * 100);
    if (ev.depositPaid && depositCents <= 0) { setEvErr("Enter the deposit amount."); return; }
    if (ev.depositPaid && depositCents > priceCents && priceCents > 0) { setEvErr("Deposit can't exceed the price."); return; }
    setEvBusy(true); setEvErr("");
    try {
      const { id } = await api<{ id: string }>("/api/jobs", { method: "POST", body: JSON.stringify({
        contact_id: ev.contactId, title: ev.title.trim(), status: "scheduled",
        scheduled_start: new Date(ev.when).toISOString(), address: ev.address || null, price_cents: priceCents,
      }) });
      if (ev.depositPaid && depositCents > 0) {
        await api(`/api/jobs/${id}/mark-paid`, { method: "POST", body: JSON.stringify({ amount_cents: depositCents, method: "deposit" }) });
      }
      setNewOpen(false); setEv(NEW_EVENT); load();
    } catch { setEvErr("Couldn't save — try again."); }
    finally { setEvBusy(false); }
  }
  // Suggest a 25% deposit when the box is ticked and no amount is set yet.
  function toggleDeposit(on: boolean) {
    const p = parseFloat(ev.price) || 0;
    setEv((f) => ({ ...f, depositPaid: on, deposit: on && !f.deposit && p > 0 ? (Math.round(p * 25) / 100).toFixed(2) : f.deposit }));
  }

  function openJob(job: Job) {
    setSelected(job);
    setMsg(""); setDepInput("");
    setWhen(job.scheduled_start ? job.scheduled_start.slice(0, 16) : "");
  }

  async function markDeposit() {
    if (!selected) return;
    const cents = Math.round((parseFloat(depInput) || 0) * 100);
    if (cents <= 0) { setMsg("Enter a deposit amount."); return; }
    try {
      await api(`/api/jobs/${selected.id}/mark-paid`, { method: "POST", body: JSON.stringify({ amount_cents: cents, method: "deposit" }) });
      setMsg("Deposit recorded — revenue updated.");
      setSelected({ ...selected, amount_paid_cents: (selected.amount_paid_cents ?? 0) + cents });
      setDepInput(""); load();
    } catch { setMsg("Couldn't record — try again."); }
  }

  async function reschedule() {
    if (!selected || !when) return;
    setMsg("");
    try {
      const iso = new Date(when).toISOString();
      await api(`/api/jobs/${selected.id}`, { method: "PATCH", body: JSON.stringify({ status: "scheduled", scheduled_start: iso }) });
      setMsg("Saved. Send the customer a confirmation?");
      load();
      setSelected({ ...selected, scheduled_start: iso });
    } catch {
      setMsg("Couldn't save — try again.");
    }
  }

  async function sendConfirmation() {
    if (!selected) return;
    try {
      const r = (await api(`/api/jobs/${selected.id}/confirm`, { method: "POST" })) as { status: string };
      setMsg(r.status === "sent" ? "Confirmation sent." : r.status === "logged" ? "Logged (email goes live once Resend is set up)." : r.status === "skipped_no_email" ? "No email on file for this customer." : `Status: ${r.status}`);
    } catch {
      setMsg("Couldn't send — try again.");
    }
  }

  const today = new Date();
  const rangeLabel = `${fmtDate(weekStart)} – ${fmtDate(addDays(weekStart, 6))}`;
  const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  return (
    <div className="p-4 md:p-8">
      <PageHeader eyebrow="Operations" title="Calendar" subtitle={rangeLabel}
        action={
          <div className="flex items-center gap-2">
            <div className="inline-flex items-center gap-1 rounded-xl bg-white p-1 shadow-sm ring-1 ring-steel-200">
              <button onClick={() => setWeekStart(addDays(weekStart, -7))} aria-label="Previous week" className="grid h-9 w-9 place-items-center rounded-lg text-chrome-400 hover:bg-steel-100 hover:text-graphite-800">‹</button>
              <button onClick={() => setWeekStart(startOfWeek())} className="rounded-lg px-3 py-1.5 text-sm font-medium text-graphite-800 hover:bg-steel-100">Today</button>
              <button onClick={() => setWeekStart(addDays(weekStart, 7))} aria-label="Next week" className="grid h-9 w-9 place-items-center rounded-lg text-chrome-400 hover:bg-steel-100 hover:text-graphite-800">›</button>
            </div>
            <Button onClick={() => openNew()}>+ New event</Button>
          </div>
        } />

      {/* Mobile agenda */}
      <div className="space-y-3 md:hidden">
        {days.map((d) => {
          const dayJobs = jobs.filter((j) => isOnDay(j.scheduled_start, d));
          const isToday = isOnDay(d.toISOString(), today);
          return (
            <div key={ymd(d)} className="rounded-xl bg-white p-3 shadow-sm ring-1 ring-steel-200">
              <div className={`mb-2 flex items-center gap-2 text-sm font-semibold ${isToday ? "text-red-600" : "text-graphite-800"}`}>
                {dayLabel(d)}{isToday && <span className="rounded-full bg-red-600 px-1.5 text-[10px] font-medium text-white">Today</span>}
              </div>
              {dayJobs.length === 0 ? <div className="text-xs text-chrome-300">No jobs</div> :
                <div className="space-y-1.5">{dayJobs.map((j) => <JobChip key={j.id} job={j} onClick={() => openJob(j)} />)}</div>}
              <button onClick={() => openNew(d)} className="mt-2 w-full rounded-md border border-dashed border-steel-200 py-1.5 text-xs text-chrome-400 hover:border-red-200 hover:text-red-500">+ Add event</button>
            </div>
          );
        })}
      </div>

      {/* Desktop week grid */}
      <div className="hidden overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-steel-200 md:block">
        <div className="grid grid-cols-7">
          {days.map((d) => {
            const dayJobs = jobs.filter((j) => isOnDay(j.scheduled_start, d));
            const isToday = isOnDay(d.toISOString(), today);
            return (
              <div key={ymd(d)} className="group min-h-[22rem] border-r border-steel-100 last:border-r-0">
                <div className={`sticky top-0 border-b border-steel-100 px-2 py-2 text-center ${isToday ? "bg-red-50" : "bg-steel-50"}`}>
                  <div className={`text-[10px] font-semibold uppercase tracking-wide ${isToday ? "text-red-600" : "text-chrome-400"}`}>{WD[d.getDay()]}</div>
                  <div className={`font-display text-lg leading-none ${isToday ? "text-red-600" : "text-graphite-900"}`}>{d.getDate()}</div>
                </div>
                <div className="space-y-1.5 p-1.5">
                  {dayJobs.map((j) => <JobChip key={j.id} job={j} onClick={() => openJob(j)} />)}
                  <button onClick={() => openNew(d)} className="w-full rounded-md border border-dashed border-steel-200 py-1 text-[11px] text-chrome-400 opacity-0 transition hover:border-red-200 hover:text-red-500 focus:opacity-100 group-hover:opacity-100">+ Add</button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Job drawer */}
      {selected && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 md:items-center" onClick={() => setSelected(null)}>
          <div className="safe-sheet w-full max-w-md rounded-t-2xl bg-white p-5 md:rounded-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-start justify-between">
              <div>
                <h2 className="text-lg font-semibold">{selected.title}</h2>
                <Link to={`/contacts/${selected.contact_id}`} className="text-sm text-red-600 hover:underline">{fullName({ first_name: selected.first_name ?? null, last_name: selected.last_name ?? null })}</Link>
              </div>
              <button onClick={() => setSelected(null)} className="min-h-[44px] px-2 text-neutral-400">✕</button>
            </div>
            <label className="mb-1 block text-sm text-neutral-600">Scheduled start</label>
            <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} className="mb-3 min-h-[44px] w-full rounded-md border border-neutral-300 px-3" />
            <div className="flex flex-wrap gap-2">
              <button onClick={reschedule} className="min-h-[44px] flex-1 rounded-md bg-neutral-900 px-4 text-white">Save time</button>
              <button onClick={sendConfirmation} className="min-h-[44px] flex-1 rounded-md bg-red-600 px-4 text-white">Send confirmation</button>
            </div>

            <div className="mt-3 border-t border-neutral-100 pt-3">
              {(selected.price_cents ?? 0) > 0 && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-neutral-600">Service price</span>
                  <span className="font-semibold text-neutral-900">{money(selected.price_cents)}</span>
                </div>
              )}
              {(selected.amount_paid_cents ?? 0) > 0 ? (
                <div className="mt-1 flex items-center gap-1.5 text-sm font-medium text-emerald-700">
                  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M5 13l4 4L19 7" /></svg>
                  {Number(selected.paid_in_full) === 1 ? `Paid in full — ${money(selected.amount_paid_cents!)}` : `Deposit ${money(selected.amount_paid_cents!)} paid`}
                </div>
              ) : (
                <div className="mt-2 flex gap-2">
                  <input value={depInput} onChange={(e) => setDepInput(e.target.value)} inputMode="decimal" placeholder="Deposit $" className="min-h-[40px] w-28 rounded-md border border-neutral-300 px-2 text-sm" />
                  <button onClick={markDeposit} className="min-h-[40px] flex-1 rounded-md bg-emerald-600 px-3 text-sm text-white">Mark deposit paid</button>
                </div>
              )}
            </div>
            {selected.phone && <a href={`sms:${selected.phone}`} className="mt-2 block min-h-[44px] rounded-md bg-neutral-200 px-4 py-3 text-center text-sm">Text {selected.phone}</a>}
            {msg && <p className="mt-3 text-sm text-neutral-600">{msg}</p>}
          </div>
        </div>
      )}

      <Modal open={newOpen} onClose={() => setNewOpen(false)} title="New calendar event"
        footer={<><Button variant="ghost" onClick={() => setNewOpen(false)}>Cancel</Button><Button onClick={saveEvent} disabled={evBusy}>{evBusy ? "Saving…" : "Add event"}</Button></>}>
        <div className="space-y-3">
          <Field label="Title"><Input value={ev.title} autoFocus onChange={(e) => setEv({ ...ev, title: e.target.value })} placeholder="e.g. Full detail — Tesla Model 3" /></Field>
          <Field label="Customer" hint="Links this event to a contact — it shows on their record.">
            <ContactPicker contactId={ev.contactId} name={ev.customer} onChange={(v) => setEv({ ...ev, contactId: v.contactId, customer: v.name })} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Date & time"><Input type="datetime-local" value={ev.when} onChange={(e) => setEv({ ...ev, when: e.target.value })} /></Field>
            <Field label="Service price ($)"><Input type="number" min="0" step="0.01" value={ev.price} onChange={(e) => setEv({ ...ev, price: e.target.value })} placeholder="0.00" /></Field>
          </div>
          <Field label="Address (optional)"><Input value={ev.address} onChange={(e) => setEv({ ...ev, address: e.target.value })} placeholder="Where" /></Field>
          <div className="rounded-lg border border-steel-200 bg-steel-50 p-3">
            <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-graphite-900">
              <input type="checkbox" checked={ev.depositPaid} onChange={(e) => toggleDeposit(e.target.checked)} className="h-4 w-4 accent-red-600" />
              Deposit paid
            </label>
            {ev.depositPaid && (
              <div className="mt-2">
                <Input type="number" min="0" step="0.01" value={ev.deposit} onChange={(e) => setEv({ ...ev, deposit: e.target.value })} placeholder="Deposit amount ($)" />
                <p className="mt-1 text-xs text-chrome-400">Counts as cash collected now; the balance stays in pipeline until the job is completed.</p>
              </div>
            )}
          </div>
          {evErr && <p className="text-sm text-rose-600">{evErr}</p>}
        </div>
      </Modal>
    </div>
  );
}
