import { useMemo, useState } from "react";
import { PageHeader, Button, Modal, Field, Input, Select, Textarea, EmptyState, DeleteButton, StatTile, Tag } from "../components/ui";
import { useCollection, type Row } from "../lib/collections";
import { useToast } from "../components/Toast";
import { money } from "../types";

/**
 * The mobile setup shopping list.
 *
 * Distinct from Products (what you sell) and from an Expense (money already
 * spent) — this is what's still to buy before the rig is complete. Ticking
 * "Purchased" doesn't file an expense automatically: the price here is an
 * estimate, and the real one belongs in Revenue → Expenses when it's paid.
 */

interface Equipment extends Row {
  name: string;
  category: string;
  est_cost_cents: number;
  priority: string;
  purchased: boolean;
  purchased_at: string | null;
  notes: string | null;
}

const CATEGORIES = [
  { value: "washing", label: "Washing" },
  { value: "polishing", label: "Polishing" },
  { value: "interior", label: "Interior" },
  { value: "power", label: "Power / water" },
  { value: "storage", label: "Storage" },
  { value: "safety", label: "Safety" },
  { value: "other", label: "Other" },
];
const PRIORITIES: Record<string, { label: string; color: string; rank: number }> = {
  must_have: { label: "Must have", color: "red", rank: 0 },
  should_have: { label: "Should have", color: "amber", rank: 1 },
  nice_to_have: { label: "Nice to have", color: "neutral", rank: 2 },
};

const BLANK = { name: "", category: "other", est_cost: "", priority: "should_have", notes: "" };

export default function Equipment() {
  const { items, loading, create, update, removeWithUndo } = useCollection<Equipment>("equipment");
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Equipment | null>(null);
  const [form, setForm] = useState(BLANK);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [showPurchased, setShowPurchased] = useState(false);

  function openNew() { setEditing(null); setForm(BLANK); setErr(""); setOpen(true); }
  function openEdit(it: Equipment) {
    setEditing(it);
    setForm({
      name: it.name, category: it.category, est_cost: it.est_cost_cents ? String(it.est_cost_cents / 100) : "",
      priority: it.priority, notes: it.notes ?? "",
    });
    setErr(""); setOpen(true);
  }

  async function save() {
    if (!form.name.trim()) { setErr("Name it."); return; }
    const cents = form.est_cost.trim() ? Math.round(parseFloat(form.est_cost) * 100) : 0;
    if (!Number.isFinite(cents) || cents < 0) { setErr("Enter a valid cost, or leave it blank."); return; }
    setBusy(true); setErr("");
    const payload = { name: form.name.trim(), category: form.category, est_cost_cents: cents, priority: form.priority, notes: form.notes };
    try {
      if (editing) await update(editing.id, payload);
      else await create({ ...payload, sort: items.length + 1 });
      setOpen(false);
    } catch { setErr("Could not save."); }
    finally { setBusy(false); }
  }

  async function togglePurchased(it: Equipment) {
    await update(it.id, { purchased: !it.purchased, purchased_at: it.purchased ? "" : new Date().toISOString() });
  }

  const { toBuy, bought, remainingCents, must } = useMemo(() => {
    const toBuy = items.filter((i) => !i.purchased).sort((a, b) => (PRIORITIES[a.priority]?.rank ?? 9) - (PRIORITIES[b.priority]?.rank ?? 9));
    const bought = items.filter((i) => i.purchased);
    const remainingCents = toBuy.reduce((s, i) => s + (i.est_cost_cents || 0), 0);
    const must = toBuy.filter((i) => i.priority === "must_have").length;
    return { toBuy, bought, remainingCents, must };
  }, [items]);

  const visible = showPurchased ? bought : toBuy;

  return (
    <div className="mx-auto max-w-3xl p-4 md:p-8">
      <PageHeader eyebrow="Operations" title="Equipment"
        subtitle="What's left to buy before the mobile setup is done."
        action={<Button onClick={openNew}>+ Add item</Button>} />

      <div className="mb-6 grid grid-cols-3 gap-3">
        <StatTile label="Still to buy" value={toBuy.length} />
        <StatTile label="Must-haves left" value={<span className={must > 0 ? "text-red-600" : ""}>{must}</span>} />
        <StatTile label="Est. remaining" value={money(remainingCents)} />
      </div>

      <div className="mb-4 flex gap-2">
        <button onClick={() => setShowPurchased(false)}
          className={`rounded-lg px-3 py-2 text-sm font-medium ${!showPurchased ? "bg-neutral-900 text-white" : "bg-white text-neutral-500 ring-1 ring-neutral-200"}`}>
          To buy ({toBuy.length})
        </button>
        <button onClick={() => setShowPurchased(true)}
          className={`rounded-lg px-3 py-2 text-sm font-medium ${showPurchased ? "bg-neutral-900 text-white" : "bg-white text-neutral-500 ring-1 ring-neutral-200"}`}>
          Purchased ({bought.length})
        </button>
      </div>

      {loading ? (
        <p className="text-sm text-chrome-400">Loading…</p>
      ) : visible.length === 0 ? (
        <EmptyState
          title={showPurchased ? "Nothing purchased yet" : "Nothing left to buy"}
          hint={showPurchased ? "Tick an item off the list once you've bought it." : "Add the gear you still need for the rig."}
          action={!showPurchased ? <Button onClick={openNew}>+ Add item</Button> : undefined}
        />
      ) : (
        <ul className="space-y-2">
          {visible.map((it) => {
            const pr = PRIORITIES[it.priority] ?? PRIORITIES.nice_to_have;
            return (
              <li key={it.id} className="flex items-start gap-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-neutral-100">
                <button onClick={() => togglePurchased(it)} aria-label={it.purchased ? "Mark not purchased" : "Mark purchased"}
                  className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-md border-2 ${
                    it.purchased ? "border-emerald-500 bg-emerald-500 text-white" : "border-neutral-300"}`}>
                  {it.purchased ? "✓" : ""}
                </button>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`font-medium text-neutral-900 ${it.purchased ? "line-through text-neutral-400" : ""}`}>{it.name}</span>
                    {!it.purchased && <Tag color={pr.color}>{pr.label}</Tag>}
                    <Tag color="neutral">{CATEGORIES.find((c) => c.value === it.category)?.label ?? it.category}</Tag>
                  </div>
                  {it.notes && <p className="mt-1 text-sm text-neutral-500">{it.notes}</p>}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {it.est_cost_cents > 0 && <span className="text-sm font-semibold text-neutral-700">{money(it.est_cost_cents)}</span>}
                  <button onClick={() => openEdit(it)} className="grid h-9 w-9 place-items-center rounded-lg text-neutral-300 hover:bg-neutral-100 hover:text-neutral-700">
                    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z" /></svg>
                  </button>
                  <DeleteButton onClick={() => removeWithUndo(it.id, toast, { label: `Removed "${it.name}".` })} />
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title={editing ? "Edit item" : "Add equipment"} size="sm"
        footer={<><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button onClick={save} disabled={busy}>{busy ? "Saving…" : editing ? "Save" : "Add"}</Button></>}>
        <div className="space-y-3">
          <Field label="Item"><Input value={form.name} autoFocus onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Pressure washer" /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Category">
              <Select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} options={CATEGORIES} />
            </Field>
            <Field label="Priority">
              <Select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}
                options={Object.entries(PRIORITIES).map(([value, p]) => ({ value, label: p.label }))} />
            </Field>
          </div>
          <Field label="Estimated cost (optional)"><Input inputMode="decimal" value={form.est_cost} onChange={(e) => setForm({ ...form, est_cost: e.target.value })} placeholder="0" /></Field>
          <Field label="Notes"><Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Model, where to buy, why it matters…" /></Field>
          {err && <p className="text-sm text-rose-600">{err}</p>}
        </div>
      </Modal>
    </div>
  );
}
