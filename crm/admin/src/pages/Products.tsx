import { useState } from "react";
import { PageHeader, Button, Modal, Field, Input, Textarea, EmptyState, DeleteButton } from "../components/ui";
import { useCollection, type Row } from "../lib/collections";
import { money } from "../types";

interface Product extends Row { name: string; price_cents: number; description: string | null; }
const BLANK = { name: "", price: "", description: "" };

export default function Products() {
  const { items, loading, create, remove } = useCollection<Product>("products");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(BLANK);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function save() {
    const cents = Math.round(parseFloat(form.price || "0") * 100);
    if (!form.name.trim()) { setErr("Name required."); return; }
    if (!Number.isFinite(cents) || cents < 0) { setErr("Valid price required."); return; }
    setBusy(true); setErr("");
    try { await create({ name: form.name, price_cents: cents, description: form.description }); setForm(BLANK); setOpen(false); }
    catch { setErr("Could not save."); } finally { setBusy(false); }
  }

  return (
    <div className="mx-auto max-w-4xl p-4 md:p-8">
      <PageHeader eyebrow="Operations" title="Products" subtitle="Services, packages, and pricing."
        action={<Button onClick={() => { setForm(BLANK); setErr(""); setOpen(true); }}>+ Add product</Button>} />

      {loading ? <p className="text-sm text-neutral-400">Loading…</p> : items.length === 0 ? (
        <EmptyState title="No products yet" hint="Add your detailing packages and pricing." action={<Button onClick={() => setOpen(true)}>+ Add product</Button>} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {items.map((p) => (
            <div key={p.id} className="group rounded-2xl bg-white p-5 shadow-sm ring-1 ring-neutral-100">
              <div className="flex items-start justify-between gap-3">
                <div className="font-semibold text-neutral-900">{p.name}</div>
                <div className="flex items-center gap-2">
                  <span className="rounded-lg bg-red-50 px-2.5 py-1 text-sm font-bold text-red-600">{money(p.price_cents)}</span>
                  <div className="opacity-0 transition group-hover:opacity-100"><DeleteButton onClick={() => remove(p.id)} /></div>
                </div>
              </div>
              {p.description && <p className="mt-2 text-sm text-neutral-600">{p.description}</p>}
            </div>
          ))}
        </div>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="Add product" size="sm"
        footer={<><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button onClick={save} disabled={busy}>{busy ? "Saving…" : "Add"}</Button></>}>
        <div className="space-y-3">
          <Field label="Name"><Input value={form.name} autoFocus onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Full Interior + Exterior" /></Field>
          <Field label="Price ($)"><Input type="number" min="0" step="0.01" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} placeholder="0.00" /></Field>
          <Field label="Description"><Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="What's included…" /></Field>
          {err && <p className="text-sm text-rose-600">{err}</p>}
        </div>
      </Modal>
    </div>
  );
}
