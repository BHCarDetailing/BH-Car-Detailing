import { useState } from "react";
import { PageHeader, Button, Modal, Field, Input, Textarea, EmptyState, DeleteButton, Timestamp } from "../components/ui";
import { useCollection, type Row } from "../lib/collections";
import { api } from "../api";
import { money } from "../types";

interface Product extends Row { name: string; price_cents: number; description: string | null; created_at?: string; }
const BLANK = { name: "", price: "", description: "" };

// Sizes we generate a product for, and website-aligned service renames.
const SIZES: { key: string; label: string }[] = [
  { key: "sedan", label: "Sedan" }, { key: "suv", label: "SUV" }, { key: "exotic", label: "Exotic" },
];
const RENAME: Record<string, string> = { "Wash & Wax": "Car Wash" };

interface Service { name: string; size_pricing: Record<string, number>; base_price_cents: number; active: boolean; description?: string | null }

export default function Products() {
  const { items, loading, create, remove, reload } = useCollection<Product>("products");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(BLANK);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [genBusy, setGenBusy] = useState(false);
  const [genNote, setGenNote] = useState("");

  async function save() {
    const cents = Math.round(parseFloat(form.price || "0") * 100);
    if (!form.name.trim()) { setErr("Name required."); return; }
    if (!Number.isFinite(cents) || cents < 0) { setErr("Valid price required."); return; }
    setBusy(true); setErr("");
    try { await create({ name: form.name, price_cents: cents, description: form.description }); setForm(BLANK); setOpen(false); }
    catch { setErr("Could not save."); } finally { setBusy(false); }
  }

  // Build a product per active service × size from Settings→Services pricing.
  async function generateFromServices() {
    setGenBusy(true); setGenNote("");
    try {
      const { items: services } = await api<{ items: Service[] }>("/api/services");
      const existing = new Set(items.map((p) => p.name.toLowerCase()));
      let created = 0, sort = items.length + 1;
      for (const svc of services.filter((s) => s.active)) {
        const label = RENAME[svc.name] ?? svc.name;
        for (const size of SIZES) {
          const price = svc.size_pricing?.[size.key] ?? svc.base_price_cents;
          if (!price) continue;
          const name = `${label} — ${size.label}`;
          if (existing.has(name.toLowerCase())) continue;
          await create({ name, price_cents: price, description: svc.description ?? "", sort: sort++ });
          existing.add(name.toLowerCase()); created++;
        }
      }
      await reload();
      setGenNote(created ? `Generated ${created} product${created === 1 ? "" : "s"} from your service menu.` : "All products already exist — nothing to add.");
    } catch { setGenNote("Couldn't reach your services. Try again."); }
    finally { setGenBusy(false); }
  }

  return (
    <div className="mx-auto max-w-4xl p-4 md:p-8">
      <PageHeader eyebrow="Operations" title="Products" subtitle="Services, packages, and pricing — per vehicle size."
        action={<div className="flex gap-2">
          <Button variant="ghost" onClick={generateFromServices} disabled={genBusy}>{genBusy ? "Generating…" : "⚡ Generate from services"}</Button>
          <Button onClick={() => { setForm(BLANK); setErr(""); setOpen(true); }}>+ Add product</Button>
        </div>} />

      {genNote && <div className="mb-4 rounded-lg bg-emerald-50 px-4 py-2 text-sm text-emerald-800 ring-1 ring-emerald-100">{genNote}</div>}

      {loading ? <p className="text-sm text-chrome-400">Loading…</p> : items.length === 0 ? (
        <EmptyState title="No products yet" hint="Generate them from your Settings → Services pricing (Sedan / SUV / Exotic), or add one manually."
          action={<Button onClick={generateFromServices} disabled={genBusy}>{genBusy ? "Generating…" : "⚡ Generate from services"}</Button>} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {items.map((p) => (
            <div key={p.id} className="group rounded-2xl bg-white p-5 shadow-sm ring-1 ring-steel-200">
              <div className="flex items-start justify-between gap-3">
                <div className="font-semibold text-graphite-950">{p.name}</div>
                <div className="flex items-center gap-2">
                  <span className="rounded-lg bg-red-50 px-2.5 py-1 text-sm font-bold text-red-600">{money(p.price_cents)}</span>
                  <div className="opacity-0 transition group-hover:opacity-100"><DeleteButton onClick={() => remove(p.id)} /></div>
                </div>
              </div>
              {p.description && <p className="mt-2 text-sm text-neutral-600">{p.description}</p>}
              {p.created_at && <div className="mt-2"><Timestamp value={p.created_at} prefix="Added" /></div>}
            </div>
          ))}
        </div>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="Add product" size="sm"
        footer={<><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button onClick={save} disabled={busy}>{busy ? "Saving…" : "Add"}</Button></>}>
        <div className="space-y-3">
          <Field label="Name"><Input value={form.name} autoFocus onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Full Detail — SUV" /></Field>
          <Field label="Price ($)"><Input type="number" min="0" step="0.01" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} placeholder="0.00" /></Field>
          <Field label="Description"><Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="What's included…" /></Field>
          {err && <p className="text-sm text-rose-600">{err}</p>}
        </div>
      </Modal>
    </div>
  );
}
