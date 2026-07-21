import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { fullName, type Job } from "../types";
import { addDays, dayLabel, isOnDay, startOfWeek, timeLabel, ymd } from "../lib/datetime";

const STATUS_COLOR: Record<string, string> = {
  quoted: "bg-amber-100 text-amber-800",
  scheduled: "bg-blue-100 text-blue-800",
  in_progress: "bg-purple-100 text-purple-800",
  completed: "bg-green-100 text-green-800",
  paid: "bg-emerald-100 text-emerald-800",
  cancelled: "bg-neutral-200 text-neutral-500",
  draft: "bg-neutral-100 text-neutral-600",
};

function JobChip({ job, onClick }: { job: Job; onClick: () => void }) {
  return (
    <button onClick={onClick} className={`w-full rounded-md px-2 py-1 text-left text-xs ${STATUS_COLOR[job.status] ?? "bg-neutral-100"}`}>
      <div className="font-medium">{job.scheduled_start ? timeLabel(job.scheduled_start) : "—"} · {job.title}</div>
      <div className="truncate opacity-80">{fullName({ first_name: job.first_name ?? null, last_name: job.last_name ?? null })}</div>
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

  return (
    <div className="p-4 md:p-8">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Calendar</h1>
        <div className="flex gap-2">
          <button onClick={() => setWeekStart(addDays(weekStart, -7))} className="min-h-[44px] rounded-md bg-neutral-200 px-3">‹</button>
          <button onClick={() => setWeekStart(startOfWeek())} className="min-h-[44px] rounded-md bg-neutral-200 px-3 text-sm">Today</button>
          <button onClick={() => setWeekStart(addDays(weekStart, 7))} className="min-h-[44px] rounded-md bg-neutral-200 px-3">›</button>
        </div>
      </div>

      {/* Mobile agenda */}
      <div className="space-y-4 md:hidden">
        {days.map((d) => {
          const dayJobs = jobs.filter((j) => isOnDay(j.scheduled_start, d));
          return (
            <div key={ymd(d)}>
              <div className="mb-1 text-sm font-semibold text-neutral-600">{dayLabel(d)}</div>
              {dayJobs.length === 0 ? <div className="text-xs text-neutral-400">—</div> :
                <div className="space-y-1">{dayJobs.map((j) => <JobChip key={j.id} job={j} onClick={() => openJob(j)} />)}</div>}
            </div>
          );
        })}
      </div>

      {/* Desktop week grid */}
      <div className="hidden grid-cols-7 gap-2 md:grid">
        {days.map((d) => {
          const dayJobs = jobs.filter((j) => isOnDay(j.scheduled_start, d));
          return (
            <div key={ymd(d)} className="min-h-40 rounded-lg bg-neutral-100 p-2">
              <div className="mb-2 text-xs font-semibold text-neutral-600">{dayLabel(d)}</div>
              <div className="space-y-1">{dayJobs.map((j) => <JobChip key={j.id} job={j} onClick={() => openJob(j)} />)}</div>
            </div>
          );
        })}
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
