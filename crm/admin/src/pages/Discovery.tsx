import { useMemo, useState } from "react";
import { PageHeader, Button, Modal, Field, Input, Textarea, Toolbar, EmptyState, DeleteButton } from "../components/ui";
import { useCollection, type Row } from "../lib/collections";

interface Note extends Row { title: string; contact: string | null; body: string | null; created_at: string; }
const BLANK = { title: "", contact: "", body: "" };

export default function Discovery() {
  const { items, loading, create, remove } = useCollection<Note>("discovery");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(BLANK);
  const [busy, setBusy] = useState(false);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return items.filter((n) => !s || (n.title + " " + (n.contact ?? "") + " " + (n.body ?? "")).toLowerCase().includes(s));
  }, [items, q]);

  async function save() {
    if (!form.title.trim()) return;
    setBusy(true);
    try { await create(form); setForm(BLANK); setOpen(false); } finally { setBusy(false); }
  }

  return (
    <div className="mx-auto max-w-3xl p-4 md:p-8">
      <PageHeader title="Discovery" subtitle="Early leads, call notes, and research — captured fast."
        action={<Button onClick={() => { setForm(BLANK); setOpen(true); }}>+ New note</Button>} />

      <Toolbar search={q} onSearch={setQ} placeholder="Search notes…" />

      {loading ? <p className="text-sm text-neutral-400">Loading…</p> : filtered.length === 0 ? (
        <EmptyState title="No discovery notes yet" hint="Capture a lead detail or a call recap to get started." action={<Button onClick={() => setOpen(true)}>+ New note</Button>} />
      ) : (
        <div className="space-y-3">
          {filtered.map((n) => (
            <div key={n.id} className="group rounded-2xl bg-white p-4 shadow-sm ring-1 ring-neutral-100">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-semibold text-neutral-900">{n.title}</div>
                  {n.contact && <div className="text-xs text-red-600">{n.contact}</div>}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-neutral-400">{new Date(n.created_at).toLocaleDateString()}</span>
                  <div className="opacity-0 transition group-hover:opacity-100"><DeleteButton onClick={() => remove(n.id)} /></div>
                </div>
              </div>
              {n.body && <p className="mt-2 whitespace-pre-wrap text-sm text-neutral-600">{n.body}</p>}
            </div>
          ))}
        </div>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="New discovery note"
        footer={<><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button onClick={save} disabled={busy}>{busy ? "Saving…" : "Save note"}</Button></>}>
        <div className="space-y-3">
          <Field label="Title"><Input value={form.title} autoFocus onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Fleet lead — Miami Exotics" /></Field>
          <Field label="Contact (optional)"><Input value={form.contact} onChange={(e) => setForm({ ...form, contact: e.target.value })} placeholder="Name, phone, or email" /></Field>
          <Field label="Notes"><Textarea value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} className="min-h-[140px]" placeholder="What you learned…" /></Field>
        </div>
      </Modal>
    </div>
  );
}
