import { useMemo, useState } from "react";
import { PageHeader, Button, Modal, Field, Input, Select, EmptyState, Tag, DeleteButton } from "../components/ui";
import { useCollection, REVENUE_KINDS, labelOf, type Row } from "../lib/collections";
import { money } from "../types";

interface Entry extends Row { label: string; kind: string; amount_cents: number; note: string | null; created_at: string; }

const BLANK = { label: "", kind: "active", amount: "", note: "" };

const TILES = [
  { kind: "arr", label: "Active ARR", hint: "Annual recurring" },
  { kind: "mrr", label: "MRR", hint: "Monthly recurring" },
  { kind: "pipeline", label: "Total pipeline", hint: "Weighted opportunity" },
  { kind: "active", label: "Total active revenue", hint: "Booked / in progress" },
] as const;

export default function Revenue() {
  const { items, loading, create, remove } = useCollection<Entry>("revenue");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<typeof BLANK>(BLANK);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const totals = useMemo(() => {
    const t: Record<string, number> = { arr: 0, mrr: 0, pipeline: 0, active: 0 };
    for (const e of items) t[e.kind] = (t[e.kind] ?? 0) + (e.amount_cents ?? 0);
    return t;
  }, [items]);

  async function save() {
    const cents = Math.round(parseFloat(form.amount) * 100);
    if (!form.label.trim()) { setErr("Add a label."); return; }
    if (!Number.isFinite(cents) || cents < 0) { setErr("Enter a valid amount."); return; }
    setBusy(true); setErr("");
    try {
      await create({ label: form.label, kind: form.kind, amount_cents: cents, note: form.note });
      setForm(BLANK); setOpen(false);
    } catch { setErr("Could not save."); }
    finally { setBusy(false); }
  }

  return (
    <div className="mx-auto max-w-5xl p-4 md:p-8">
      <PageHeader eyebrow="Growth" title="Revenue" subtitle="Recurring, pipeline, and active revenue at a glance."
        action={<Button onClick={() => { setForm(BLANK); setErr(""); setOpen(true); }}>+ Add revenue</Button>} />

      <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {TILES.map((t, i) => (
          <div key={t.kind} className={`bh-gloss rounded-2xl p-5 shadow-sm ring-1 ${i === 0 ? "bg-gradient-to-br from-graphite-900 to-graphite-950 text-white ring-white/5" : "bg-white ring-steel-200"}`}>
            <div className={`eyebrow text-[10px] ${i === 0 ? "text-chrome-400" : "text-chrome-400"}`}>{t.label}</div>
            <div className={`font-display mt-1.5 text-3xl leading-none ${i === 0 ? "text-white" : i === 3 ? "text-red-600" : "text-graphite-950"}`}>{money(totals[t.kind] ?? 0)}</div>
            <div className={`mt-1.5 text-xs ${i === 0 ? "text-chrome-400" : "text-chrome-400"}`}>{t.hint}</div>
          </div>
        ))}
      </div>

      {loading ? (
        <p className="text-sm text-neutral-400">Loading…</p>
      ) : items.length === 0 ? (
        <EmptyState title="No revenue entries yet" hint="Log ARR, MRR, pipeline, or active revenue to build your totals."
          action={<Button onClick={() => setOpen(true)}>+ Add revenue</Button>} />
      ) : (
        <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-neutral-100">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-500">
              <tr><th className="px-4 py-3 font-medium">Entry</th><th className="px-4 py-3 font-medium">Kind</th><th className="px-4 py-3 text-right font-medium">Amount</th><th /></tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {items.map((e) => (
                <tr key={e.id} className="hover:bg-neutral-50">
                  <td className="px-4 py-3">
                    <div className="font-medium text-neutral-900">{e.label}</div>
                    {e.note && <div className="text-xs text-neutral-400">{e.note}</div>}
                  </td>
                  <td className="px-4 py-3"><Tag color={e.kind === "active" ? "brand" : "blue"}>{labelOf(REVENUE_KINDS, e.kind)}</Tag></td>
                  <td className="px-4 py-3 text-right font-semibold text-neutral-900">{money(e.amount_cents)}</td>
                  <td className="px-4 py-3 text-right"><DeleteButton onClick={() => remove(e.id)} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="Add revenue" size="sm"
        footer={<><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button onClick={save} disabled={busy}>{busy ? "Saving…" : "Add"}</Button></>}>
        <div className="space-y-3">
          <Field label="Label"><Input value={form.label} autoFocus onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="e.g. Dealership monthly contract" /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Kind"><Select options={REVENUE_KINDS} value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })} /></Field>
            <Field label="Amount ($)"><Input type="number" min="0" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="0.00" /></Field>
          </div>
          <Field label="Note (optional)"><Input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="Context…" /></Field>
          {err && <p className="text-sm text-rose-600">{err}</p>}
        </div>
      </Modal>
    </div>
  );
}
