import { useMemo, useState } from "react";
import { PageHeader, Button, Modal, Field, Input, Textarea, Toolbar, EmptyState, DeleteButton } from "../components/ui";
import { useCollection, type Row } from "../lib/collections";

interface Doc extends Row { title: string; category: string | null; url: string | null; notes: string | null; }
const BLANK = { title: "", category: "", url: "", notes: "" };

export default function DocsLegal() {
  const { items, loading, create, remove } = useCollection<Doc>("docs");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(BLANK);
  const [busy, setBusy] = useState(false);

  const groups = useMemo(() => {
    const s = q.trim().toLowerCase();
    const filtered = items.filter((d) => !s || (d.title + " " + (d.category ?? "") + " " + (d.notes ?? "")).toLowerCase().includes(s));
    const map = new Map<string, Doc[]>();
    for (const d of filtered) {
      const k = d.category?.trim() || "General";
      (map.get(k) ?? map.set(k, []).get(k)!).push(d);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [items, q]);

  async function save() {
    if (!form.title.trim()) return;
    setBusy(true);
    try { await create(form); setForm(BLANK); setOpen(false); } finally { setBusy(false); }
  }

  return (
    <div className="mx-auto max-w-4xl p-4 md:p-8">
      <PageHeader eyebrow="Tools" title="Docs & Legal" subtitle="Agreements, internal files, and important references."
        action={<Button onClick={() => { setForm(BLANK); setOpen(true); }}>+ Add doc</Button>} />

      <Toolbar search={q} onSearch={setQ} placeholder="Search docs…" />

      {loading ? <p className="text-sm text-neutral-400">Loading…</p> : items.length === 0 ? (
        <EmptyState title="No documents yet" hint="Add links to agreements, SOPs, and legal files." action={<Button onClick={() => setOpen(true)}>+ Add doc</Button>} />
      ) : (
        <div className="space-y-6">
          {groups.map(([cat, docs]) => (
            <div key={cat}>
              <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-400">{cat}</div>
              <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-neutral-100">
                <ul className="divide-y divide-neutral-100">
                  {docs.map((d) => (
                    <li key={d.id} className="group flex items-center gap-3 p-4">
                      <div className="grid h-9 w-9 place-items-center rounded-lg bg-neutral-100 text-neutral-400">
                        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M7 3h9l3 3v15H7zM15 3v4h4" /></svg>
                      </div>
                      <div className="min-w-0 flex-1">
                        {d.url ? (
                          <a href={d.url} target="_blank" rel="noopener noreferrer" className="font-medium text-neutral-900 hover:text-red-600">{d.title}</a>
                        ) : <span className="font-medium text-neutral-900">{d.title}</span>}
                        {d.notes && <div className="truncate text-xs text-neutral-400">{d.notes}</div>}
                      </div>
                      {d.url && <span className="text-xs text-neutral-400">↗</span>}
                      <div className="opacity-0 transition group-hover:opacity-100"><DeleteButton onClick={() => remove(d.id)} /></div>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="Add document" size="sm"
        footer={<><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button onClick={save} disabled={busy}>{busy ? "Saving…" : "Add"}</Button></>}>
        <div className="space-y-3">
          <Field label="Title"><Input value={form.title} autoFocus onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
          <Field label="Category"><Input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="e.g. Agreements, SOPs, Insurance" /></Field>
          <Field label="Link (URL)"><Input value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="https://…" /></Field>
          <Field label="Notes"><Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
        </div>
      </Modal>
    </div>
  );
}
