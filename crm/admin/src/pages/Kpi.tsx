import { useState } from "react";
import { PageHeader, Button, Modal, Field, Input, EmptyState, DeleteButton } from "../components/ui";
import { useCollection, type Row } from "../lib/collections";

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
  return u === "$" ? `$${v}` : u.startsWith("$") ? `$${v}` : `${v}${u ? u : ""}`;
}

export default function Kpi() {
  const { items, loading, create, update, remove } = useCollection<Kpi>("kpis");
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
      <PageHeader eyebrow="Performance" title="KPIs" subtitle="The numbers that run the business — editable targets and current values."
        action={<Button onClick={openNew}>+ Add KPI</Button>} />

      {loading ? <p className="text-sm text-neutral-400">Loading…</p> : items.length === 0 ? (
        <EmptyState title="No KPIs yet" hint="Add the metrics you want to steer by." action={<Button onClick={openNew}>+ Add KPI</Button>} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((k) => {
            const p = pct(k.current, k.target);
            return (
              <div key={k.id} className="group rounded-2xl bg-white p-5 shadow-sm ring-1 ring-neutral-100">
                <div className="flex items-start justify-between">
                  <div className="text-sm font-medium text-neutral-500">{k.label}</div>
                  <div className="flex items-center gap-1 opacity-0 transition group-hover:opacity-100">
                    <button onClick={() => openEdit(k)} className="grid h-8 w-8 place-items-center rounded-lg text-neutral-300 hover:bg-neutral-100 hover:text-neutral-700">
                      <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z" /></svg>
                    </button>
                    <DeleteButton onClick={() => remove(k.id)} />
                  </div>
                </div>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="font-display text-4xl leading-none text-graphite-950">{fmt(k.current, k.unit)}</span>
                  <span className="text-sm text-chrome-400">/ {fmt(k.target, k.unit)}</span>
                </div>
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

      <Modal open={open} onClose={() => setOpen(false)} title={editing ? "Edit KPI" : "Add KPI"} size="sm"
        footer={<><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button onClick={save} disabled={busy}>{busy ? "Saving…" : editing ? "Save" : "Add"}</Button></>}>
        <div className="space-y-3">
          <Field label="Metric"><Input value={form.label} autoFocus onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="e.g. Jobs completed" /></Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Current"><Input value={form.current} onChange={(e) => setForm({ ...form, current: e.target.value })} placeholder="0" /></Field>
            <Field label="Target"><Input value={form.target} onChange={(e) => setForm({ ...form, target: e.target.value })} placeholder="0" /></Field>
            <Field label="Unit"><Input value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} placeholder="$, %, /mo" /></Field>
          </div>
        </div>
      </Modal>
    </div>
  );
}
