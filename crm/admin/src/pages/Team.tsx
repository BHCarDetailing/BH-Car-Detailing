import { useState } from "react";
import { PageHeader, Button, Modal, Field, Input, Textarea, EmptyState, DeleteButton } from "../components/ui";
import { useCollection, type Row } from "../lib/collections";

interface Member extends Row { name: string; role: string | null; focus: string | null; bandwidth: string | null; }
const BLANK = { name: "", role: "", focus: "", bandwidth: "" };

export default function Team() {
  const { items, loading, create, remove } = useCollection<Member>("team");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(BLANK);
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!form.name.trim()) return;
    setBusy(true);
    try { await create(form); setForm(BLANK); setOpen(false); } finally { setBusy(false); }
  }

  return (
    <div className="mx-auto max-w-5xl p-4 md:p-8">
      <PageHeader title="Team" subtitle="Who's on the crew, what they own, and their bandwidth."
        action={<Button onClick={() => { setForm(BLANK); setOpen(true); }}>+ Add member</Button>} />

      {loading ? <p className="text-sm text-neutral-400">Loading…</p> : items.length === 0 ? (
        <EmptyState title="No team members yet" hint="Add your crew to track roles and bandwidth." action={<Button onClick={() => setOpen(true)}>+ Add member</Button>} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((m) => (
            <div key={m.id} className="group rounded-2xl bg-white p-5 shadow-sm ring-1 ring-neutral-100">
              <div className="flex items-start justify-between">
                <div className="grid h-11 w-11 place-items-center rounded-full bg-red-50 text-sm font-bold text-red-600">
                  {m.name.split(" ").map((s) => s[0]).slice(0, 2).join("").toUpperCase()}
                </div>
                <div className="opacity-0 transition group-hover:opacity-100"><DeleteButton onClick={() => remove(m.id)} /></div>
              </div>
              <div className="mt-3 font-semibold text-neutral-900">{m.name}</div>
              {m.role && <div className="text-sm text-red-600">{m.role}</div>}
              {m.focus && <div className="mt-2 text-sm text-neutral-600">{m.focus}</div>}
              {m.bandwidth && <div className="mt-2 rounded-lg bg-neutral-50 px-3 py-2 text-xs text-neutral-500">{m.bandwidth}</div>}
            </div>
          ))}
        </div>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="Add team member"
        footer={<><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button onClick={save} disabled={busy}>{busy ? "Saving…" : "Add"}</Button></>}>
        <div className="space-y-3">
          <Field label="Name"><Input value={form.name} autoFocus onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label="Role"><Input value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} placeholder="e.g. Lead Detailer" /></Field>
          <Field label="Focus area"><Input value={form.focus} onChange={(e) => setForm({ ...form, focus: e.target.value })} placeholder="e.g. Ceramic coating, fleet accounts" /></Field>
          <Field label="Bandwidth notes"><Textarea value={form.bandwidth} onChange={(e) => setForm({ ...form, bandwidth: e.target.value })} placeholder="Availability, capacity, constraints…" /></Field>
        </div>
      </Modal>
    </div>
  );
}
