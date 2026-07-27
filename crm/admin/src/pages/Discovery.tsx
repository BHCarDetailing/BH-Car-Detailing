import { useMemo, useState } from "react";
import { PageHeader, Button, Modal, Field, Input, Textarea, Toolbar, EmptyState, DeleteButton, Tabs, Timestamp } from "../components/ui";
import { useCollection, type Row } from "../lib/collections";

interface Note extends Row { title: string; contact: string | null; body: string | null; created_at: string; }
const BLANK = { title: "", contact: "", body: "" };

const TABS = [
  { value: "notes", label: "Notes" },
  { value: "calls", label: "Calls" },
] as const;

export default function Discovery() {
  const { items, loading, create, remove } = useCollection<Note>("discovery");
  const [tab, setTab] = useState("notes");
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
      <PageHeader eyebrow="Growth" title="Discovery" subtitle="Early leads, call notes, and research — captured fast."
        action={<Button onClick={() => { setForm(BLANK); setOpen(true); }}>+ New note</Button>} />

      <Tabs tabs={TABS} value={tab} onChange={setTab} />

      {tab === "notes" && (
        <>
          <Toolbar search={q} onSearch={setQ} placeholder="Search notes…" />
          {loading ? <p className="text-sm text-chrome-400">Loading…</p> : filtered.length === 0 ? (
            <EmptyState title="No discovery notes yet" hint="Capture a lead detail or a call recap to get started." action={<Button onClick={() => setOpen(true)}>+ New note</Button>} />
          ) : (
            <div className="space-y-3">
              {filtered.map((n) => (
                <div key={n.id} className="group rounded-2xl bg-white p-4 shadow-sm ring-1 ring-steel-200">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-semibold text-graphite-950">{n.title}</div>
                      {n.contact && <div className="text-xs text-red-600">{n.contact}</div>}
                    </div>
                    <div className="flex items-center gap-2">
                      <Timestamp value={n.created_at} />
                      <div className="opacity-0 transition group-hover:opacity-100"><DeleteButton onClick={() => remove(n.id)} /></div>
                    </div>
                  </div>
                  {n.body && <p className="mt-2 whitespace-pre-wrap text-sm text-neutral-600">{n.body}</p>}
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {tab === "calls" && (
        <div className="space-y-4">
          <div className="rounded-2xl border border-dashed border-steel-200 bg-white p-6">
            <div className="mb-2 flex items-center gap-2">
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-red-50 text-red-600">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 5a2 2 0 012-2h2l2 5-2 1a11 11 0 005 5l1-2 5 2v2a2 2 0 01-2 2A16 16 0 014 5z" /></svg>
              </span>
              <h2 className="font-display text-lg text-graphite-950">Call intelligence</h2>
            </div>
            <p className="text-sm text-neutral-600">Coming next: every sales call auto-records, transcribes, and returns an AI breakdown — summary, action items, objections, and follow-ups — so you never write notes by hand.</p>
            <ul className="mt-3 space-y-1 text-sm text-chrome-400">
              <li>• Auto-record &amp; upload — activates once <span className="text-neutral-600">Twilio</span> is connected</li>
              <li>• AI transcription + meeting summary — activates with your <span className="text-neutral-600">Anthropic key</span></li>
            </ul>
            <div className="mt-4">
              <Button variant="ghost" onClick={() => { setForm({ ...BLANK, title: "Call — " }); setOpen(true); }}>+ Log a call manually</Button>
            </div>
          </div>
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
