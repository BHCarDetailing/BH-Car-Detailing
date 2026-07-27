import { useState } from "react";
import { PageHeader, Button, Modal, Field, Input, Select, Textarea, EmptyState, Tag, DeleteButton } from "../components/ui";
import { useCollection, CADENCES, labelOf, type Row } from "../lib/collections";

interface Advisor extends Row { name: string; email: string | null; cadence: string | null; last_contact: string | null; notes: string | null; }
const BLANK = { name: "", email: "", cadence: "monthly", notes: "" };

function dueLabel(a: Advisor): { text: string; color: string } {
  if (!a.last_contact) return { text: "Never contacted", color: "amber" };
  const days = Math.floor((Date.now() - new Date(a.last_contact).getTime()) / 86400000);
  const window = a.cadence === "weekly" ? 7 : a.cadence === "quarterly" ? 90 : a.cadence === "none" ? Infinity : 30;
  if (days >= window) return { text: `Due · last ${days}d ago`, color: "red" };
  return { text: `Last ${days}d ago`, color: "green" };
}

export default function Advisors() {
  const { items, loading, create, update, remove } = useCollection<Advisor>("advisors");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(BLANK);
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!form.name.trim()) return;
    setBusy(true);
    try { await create(form); setForm(BLANK); setOpen(false); } finally { setBusy(false); }
  }
  function logOutreach(a: Advisor) { update(a.id, { last_contact: new Date().toISOString().slice(0, 10) }); }

  return (
    <div className="mx-auto max-w-4xl p-4 md:p-8">
      <PageHeader eyebrow="People" title="Advisors" subtitle="Mentors and advisors — keep periodic outreach on track."
        action={<Button onClick={() => { setForm(BLANK); setOpen(true); }}>+ Add advisor</Button>} />

      {loading ? <p className="text-sm text-neutral-400">Loading…</p> : items.length === 0 ? (
        <EmptyState title="No advisors yet" hint="Add advisors and set a cadence to stay in touch." action={<Button onClick={() => setOpen(true)}>+ Add advisor</Button>} />
      ) : (
        <div className="space-y-3">
          {items.map((a) => {
            const due = dueLabel(a);
            return (
              <div key={a.id} className="group flex flex-wrap items-center gap-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-neutral-100">
                <div className="min-w-[160px] flex-1">
                  <div className="font-semibold text-neutral-900">{a.name}</div>
                  {a.email && <a href={`mailto:${a.email}`} className="text-sm text-neutral-500 hover:text-red-600">{a.email}</a>}
                  {a.notes && <p className="mt-1 text-sm text-neutral-500">{a.notes}</p>}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-neutral-400">{labelOf(CADENCES, a.cadence)}</span>
                  <Tag color={due.color}>{due.text}</Tag>
                  <Button variant="ghost" onClick={() => logOutreach(a)}>Log outreach</Button>
                  <div className="opacity-0 transition group-hover:opacity-100"><DeleteButton onClick={() => remove(a.id)} /></div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="Add advisor" size="sm"
        footer={<><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button onClick={save} disabled={busy}>{busy ? "Saving…" : "Add"}</Button></>}>
        <div className="space-y-3">
          <Field label="Name"><Input value={form.name} autoFocus onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Email"><Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
            <Field label="Cadence"><Select options={CADENCES} value={form.cadence} onChange={(e) => setForm({ ...form, cadence: e.target.value })} /></Field>
          </div>
          <Field label="Notes"><Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
        </div>
      </Modal>
    </div>
  );
}
