import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { fullName, type Job } from "../types";
import { addDays, dayLabel, isOnDay, startOfWeek, timeLabel, ymd, fmtDate } from "../lib/datetime";
import { PageHeader } from "../components/ui";

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
  return (
    <button onClick={onClick} className={`w-full rounded-md border-l-[3px] px-2 py-1.5 text-left text-xs shadow-sm transition hover:brightness-[0.98] ${STATUS_COLOR[job.status] ?? "border-neutral-300 bg-neutral-50"}`}>
      <div className="font-semibold">{job.scheduled_start ? timeLabel(job.scheduled_start) : "—"}</div>
      <div className="truncate font-medium">{job.title}</div>
      <div className="truncate opacity-70">{fullName({ first_name: job.first_name ?? null, last_name: job.last_name ?? null })}</div>
    </button>
  );
}

export default function Calendar() {
  const [weekStart, setWeekStart] = useState(() => startOfWeek());
  const [jobs, setJobs] = useState<Job[]>([]);
  const [selected, setSelected] = useState<Job | null>(null);
  const [when, setWhen] = useState("");
  const [msg, setMsg] = useState("");

  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  const load = useCallback(() => {
    const from = ymd(weekStart);
    const to = ymd(addDays(weekStart, 6));
    api<{ items: Job[] }>(`/api/jobs?from=${from}&to=${to}`).then((r) => setJobs(r.items)).catch(() => {});
  }, [weekStart]);
  useEffect(load, [load]);

  function openJob(job: Job) {
    setSelected(job);
    setMsg("");
    setWhen(job.scheduled_start ? job.scheduled_start.slice(0, 16) : "");
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
          <div className="inline-flex items-center gap-1 rounded-xl bg-white p-1 shadow-sm ring-1 ring-steel-200">
            <button onClick={() => setWeekStart(addDays(weekStart, -7))} aria-label="Previous week" className="grid h-9 w-9 place-items-center rounded-lg text-chrome-400 hover:bg-steel-100 hover:text-graphite-800">‹</button>
            <button onClick={() => setWeekStart(startOfWeek())} className="rounded-lg px-3 py-1.5 text-sm font-medium text-graphite-800 hover:bg-steel-100">Today</button>
            <button onClick={() => setWeekStart(addDays(weekStart, 7))} aria-label="Next week" className="grid h-9 w-9 place-items-center rounded-lg text-chrome-400 hover:bg-steel-100 hover:text-graphite-800">›</button>
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
              <div key={ymd(d)} className="min-h-[22rem] border-r border-steel-100 last:border-r-0">
                <div className={`sticky top-0 border-b border-steel-100 px-2 py-2 text-center ${isToday ? "bg-red-50" : "bg-steel-50"}`}>
                  <div className={`text-[10px] font-semibold uppercase tracking-wide ${isToday ? "text-red-600" : "text-chrome-400"}`}>{WD[d.getDay()]}</div>
                  <div className={`font-display text-lg leading-none ${isToday ? "text-red-600" : "text-graphite-900"}`}>{d.getDate()}</div>
                </div>
                <div className="space-y-1.5 p-1.5">{dayJobs.map((j) => <JobChip key={j.id} job={j} onClick={() => openJob(j)} />)}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Job drawer */}
      {selected && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 md:items-center" onClick={() => setSelected(null)}>
          <div className="w-full max-w-md rounded-t-2xl bg-white p-5 md:rounded-2xl" onClick={(e) => e.stopPropagation()}>
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
            {selected.phone && <a href={`sms:${selected.phone}`} className="mt-2 block min-h-[44px] rounded-md bg-neutral-200 px-4 py-3 text-center text-sm">Text {selected.phone}</a>}
            {msg && <p className="mt-3 text-sm text-neutral-600">{msg}</p>}
          </div>
        </div>
      )}
    </div>
  );
}
