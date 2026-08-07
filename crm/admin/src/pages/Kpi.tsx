import { useEffect, useMemo, useState } from "react";
import { PageHeader, Button, Modal, Field, Input, EmptyState, DeleteButton, Skeleton } from "../components/ui";
import { useCollection, type Row } from "../lib/collections";
import { useToast } from "../components/Toast";
import { api } from "../api";

interface AcctTask extends Row { bucket: string; status: string }

function TaskProgress() {
  const { items } = useCollection<AcctTask>("acct_tasks");
  const active = useMemo(() => items.filter((t) => t.bucket !== "wins"), [items]);
  const done = active.filter((t) => t.status === "done").length;
  const total = active.length;
  const pct = total ? Math.round((done / total) * 100) : 0;
  const remaining = total - done;
  return (
    <div className="mb-6 bh-gloss rounded-2xl bg-gradient-to-br from-graphite-900 to-graphite-950 p-5 text-white shadow-sm ring-1 ring-white/5">
      <div className="flex items-baseline justify-between">
        <div className="eyebrow text-[10px] text-chrome-400">Task completion</div>
        <div className="font-display text-3xl leading-none">{pct}%</div>
      </div>
      <div className="mt-3 h-2.5 w-full overflow-hidden rounded-full bg-white/10">
        <div className="h-full rounded-full bg-gradient-to-r from-red-600 to-red-400" style={{ width: `${pct}%`, animation: "bh-bar 0.6s ease-out both" }} />
      </div>
      <div className="mt-2 text-xs text-chrome-400">{done} of {total} done · {remaining} remaining — updates as you close tasks in Accountability</div>
    </div>
  );
}

interface Kpi extends Row { label: string; target: string | null; current: string | null; unit: string | null; sort: number; }
const BLANK = { label: "", target: "", current: "", unit: "" };

function pct(cur: string | null, tgt: string | null): number | null {
  const c = parseFloat((cur ?? "").replace(/[^0-9.]/g, ""));
  const t = parseFloat((tgt ?? "").replace(/[^0-9.]/g, ""));
  if (!Number.isFinite(c) || !Number.isFinite(t) || t <= 0) return null;
  return Math.max(0, Math.min(100, Math.round((c / t) * 100)));
}
function fmt(v: string | null, unit: string | null): string {
  if (!v) return "—";
  const u = unit ?? "";
  // Group thousands — "$20,000" reads as money, "$20000" reads as a typo.
  const n = Number(String(v).replace(/[^0-9.-]/g, ""));
  const body = Number.isFinite(n) && String(v).trim() !== "" ? n.toLocaleString("en-US") : v;
  if (u.startsWith("$")) return `$${body}${u.slice(1)}`;
  return `${body}${u}`;
}

interface LiveKpis {
  jobs_completed_month: number;
  new_leads_week: number;
  lead_to_booked_pct: number | null;
  rebook_rate_pct: number | null;
  reviews_month: number;
}
interface StatsRevenue { revenue?: { month_cents?: number; avg_ticket_cents?: number } }

/**
 * Which KPIs the system can measure for itself.
 *
 * Matched on the seeded id, falling back to the label, so a KPI that was
 * renamed or re-created by hand still binds to its live source. Money comes
 * from /api/stats — the same numbers the Dashboard and Revenue pages show.
 */
function liveValueFor(
  k: Kpi, live: LiveKpis | null, stats: StatsRevenue | null
): { value: string; note: string } | null {
  if (!live && !stats) return null;
  const id = k.id;
  const label = (k.label ?? "").toLowerCase();
  const is = (key: string, ...words: string[]) => id === key || words.some((w) => label.includes(w));

  if (is("kpi_jobs", "jobs completed", "jobs")) {
    return live ? { value: String(live.jobs_completed_month), note: "completed this month" } : null;
  }
  if (is("kpi_ticket", "avg ticket", "average ticket")) {
    const c = stats?.revenue?.avg_ticket_cents;
    return c != null ? { value: String(Math.round(c / 100)), note: "average sale to date" } : null;
  }
  if (is("kpi_leads", "new leads", "leads")) {
    return live ? { value: String(live.new_leads_week), note: "new in the last 7 days" } : null;
  }
  if (is("kpi_booked", "lead to booked", "close rate", "conversion")) {
    return live?.lead_to_booked_pct != null
      ? { value: String(live.lead_to_booked_pct), note: "of the last 30 days of leads" } : null;
  }
  if (is("kpi_rebook", "rebook")) {
    return live?.rebook_rate_pct != null
      ? { value: String(live.rebook_rate_pct), note: "of customers came back" } : null;
  }
  if (is("kpi_reviews", "review")) {
    return live ? { value: String(live.reviews_month), note: "received this month" } : null;
  }
  if (is("kpi_revenue", "revenue")) {
    const c = stats?.revenue?.month_cents;
    return c != null ? { value: String(Math.round(c / 100)), note: "collected this month" } : null;
  }
  return null;
}

export default function Kpi() {
  const { items, loading, create, update, removeWithUndo } = useCollection<Kpi>("kpis");
  const toast = useToast();
  const [live, setLive] = useState<LiveKpis | null>(null);
  const [stats, setStats] = useState<StatsRevenue | null>(null);

  useEffect(() => {
    api<LiveKpis>("/api/stats/kpi").then(setLive).catch(() => {});
    api<StatsRevenue>("/api/stats").then(setStats).catch(() => {});
  }, []);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Kpi | null>(null);
  const [form, setForm] = useState(BLANK);
  const [busy, setBusy] = useState(false);

  function openNew() { setEditing(null); setForm(BLANK); setOpen(true); }
  function openEdit(k: Kpi) { setEditing(k); setForm({ label: k.label, target: k.target ?? "", current: k.current ?? "", unit: k.unit ?? "" }); setOpen(true); }

  async function save() {
    if (!form.label.trim()) return;
    setBusy(true);
    try {
      if (editing) await update(editing.id, form);
      else await create({ ...form, sort: items.length + 1 });
      setOpen(false);
    } finally { setBusy(false); }
  }

  return (
    <div className="mx-auto max-w-5xl p-4 md:p-8">
      <PageHeader eyebrow="Performance" title="KPIs"
        subtitle="The numbers that run the business. Anything marked Live is measured from your data — set the target and the CRM keeps score."
        action={<Button onClick={openNew}>+ Add KPI</Button>} />

      <TaskProgress />

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-neutral-100">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="mt-3 h-9 w-32" />
              <Skeleton className="mt-4 h-1.5 w-full" />
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState title="No KPIs yet" hint="Add the metrics you want to steer by." action={<Button onClick={openNew}>+ Add KPI</Button>} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {items.map((k) => {
            // A measured value always wins over a typed one — a stale number
            // someone entered in June is worse than no number at all.
            const auto = liveValueFor(k, live, stats);
            const shown = auto?.value ?? k.current;
            const p = pct(shown, k.target);
            return (
              <div key={k.id} className="group rounded-2xl bg-white p-5 shadow-sm ring-1 ring-neutral-100">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2 text-sm font-medium text-neutral-500">
                    {k.label}
                    {auto && (
                      <span title="Calculated from your live data" className="rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700">
                        Live
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1 opacity-0 transition group-hover:opacity-100">
                    <button onClick={() => openEdit(k)} className="grid h-8 w-8 place-items-center rounded-lg text-neutral-300 hover:bg-neutral-100 hover:text-neutral-700">
                      <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z" /></svg>
                    </button>
                    <DeleteButton onClick={() => removeWithUndo(k.id, toast, { label: `Deleted “${k.label}”.` })} />
                  </div>
                </div>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="font-display text-4xl leading-none text-graphite-950">{fmt(shown, k.unit)}</span>
                  <span className="text-sm text-chrome-400">/ {fmt(k.target, k.unit)}</span>
                </div>
                {auto && <div className="mt-1 text-xs text-chrome-400">{auto.note}</div>}
                {p !== null && (
                  <div className="mt-3">
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-neutral-100">
                      <div className={`h-full rounded-full ${p >= 100 ? "bg-emerald-500" : "bg-red-500"}`} style={{ width: `${p}%` }} />
                    </div>
                    <div className="mt-1 text-xs text-neutral-400">{p}% of target</div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <Modal open={open} onClose={() => setOpen(false)}
        // Tapping away keeps an edit; a half-filled new KPI is discarded.
        onDismiss={editing ? () => { void save(); } : () => setOpen(false)}
        title={editing ? "Edit KPI" : "Add KPI"} size="sm"
        footer={<><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button onClick={save} disabled={busy}>{busy ? "Saving…" : editing ? "Save" : "Add"}</Button></>}>
        <div className="space-y-3">
          <Field label="Metric"><Input value={form.label} autoFocus onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="e.g. Jobs completed" /></Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Current"><Input value={form.current} onChange={(e) => setForm({ ...form, current: e.target.value })} placeholder="0" /></Field>
            <Field label="Target"><Input value={form.target} onChange={(e) => setForm({ ...form, target: e.target.value })} placeholder="0" /></Field>
            <Field label="Unit"><Input value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} placeholder="$, %, /mo" /></Field>
          </div>
          {editing && liveValueFor(editing, live, stats) && (
            <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
              This one is measured from your data, so "Current" is ignored — set the target and the CRM keeps score.
            </p>
          )}
        </div>
      </Modal>
    </div>
  );
}
