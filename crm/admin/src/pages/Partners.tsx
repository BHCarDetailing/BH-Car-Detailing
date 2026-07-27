import { useMemo, useState } from "react";
import { PageHeader, Button, Modal, Field, Input, Select, Textarea, Toolbar, Tag, EmptyState, DeleteButton } from "../components/ui";
import { useCollection, type Row } from "../lib/collections";

interface Partner extends Row { name: string; kind: string; email: string | null; phone: string | null; notes: string | null; }
const KINDS = [{ value: "partner", label: "Partner" }, { value: "sdr", label: "SDR" }] as const;
const BLANK = { name: "", kind: "partner", email: "", phone: "", notes: "" };

export default function Partners() {
  const { items, loading, create, remove } = useCollection<Partner>("partners");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(BLANK);
  const [busy, setBusy] = useState(false);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return items.filter((p) => !s || (p.name + " " + (p.email ?? "") + " " + (p.notes ?? "")).toLowerCase().includes(s));
  }, [items, q]);

  async function save() {
    if (!form.name.trim()) return;
    setBusy(true);
    try { await create(form); setForm(BLANK); setOpen(false); } finally { setBusy(false); }
  }

  return (
    <div className="mx-auto max-w-4xl p-4 md:p-8">
      <PageHeader title="Partners & SDRs" subtitle="Outreach contacts and sales development reps."
        action={<Button onClick={() => { setForm(BLANK); setOpen(true); }}>+ Add contact</Button>} />

      <Toolbar search={q} onSearch={setQ} placeholder="Search partners & SDRs…" />

      {loading ? <p className="text-sm text-neutral-400">Loading…</p> : filtered.length === 0 ? (
        <EmptyState title="No contacts yet" hint="Add partners and SDRs to keep outreach organized." action={<Button onClick={() => setOpen(true)}>+ Add contact</Button>} />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {filtered.map((p) => (
            <div key={p.id} className="group rounded-2xl bg-white p-4 shadow-sm ring-1 ring-neutral-100">
              <div className="flex items-start justify-between">
                <div>
                  <div className="font-semibold text-neutral-900">{p.name}</div>
                  <Tag color={p.kind === "sdr" ? "blue" : "brand"}>{p.kind === "sdr" ? "SDR" : "Partner"}</Tag>
                </div>
                <div className="opacity-0 transition group-hover:opacity-100"><DeleteButton onClick={() => remove(p.id)} /></div>
              </div>
              <div className="mt-3 space-y-1 text-sm text-neutral-600">
                {p.email && <div><a href={`mailto:${p.email}`} className="hover:text-red-600">{p.email}</a></div>}
                {p.phone && <div><a href={`tel:${p.phone}`} className="hover:text-red-600">{p.phone}</a></div>}
                {p.notes && <p className="text-neutral-500">{p.notes}</p>}
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="Add partner / SDR" size="sm"
        footer={<><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button onClick={save} disabled={busy}>{busy ? "Saving…" : "Add"}</Button></>}>
        <div className="space-y-3">
          <Field label="Name"><Input value={form.name} autoFocus onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label="Type"><Select options={KINDS} value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Email"><Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
            <Field label="Phone"><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
          </div>
          <Field label="Notes"><Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
        </div>
      </Modal>
    </div>
  );
}
