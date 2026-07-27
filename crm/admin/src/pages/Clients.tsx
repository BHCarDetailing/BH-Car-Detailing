import { useMemo, useState } from "react";
import { PageHeader, Button, Modal, Field, Input, Select, Textarea, Toolbar, Tag, EmptyState, DeleteButton, Timestamp } from "../components/ui";
import { useCollection, CLIENT_TYPES, CLIENT_STAGES, labelOf, colorOf, type Row } from "../lib/collections";

interface Client extends Row {
  name: string; type: string; stage: string; email: string | null; notes: string | null; created_at: string; updated_at: string;
}

const BLANK = { name: "", type: "residential", stage: "lead", email: "", notes: "" };

export default function Clients() {
  const { items, loading, create, update, remove } = useCollection<Client>("clients");
  const [q, setQ] = useState("");
  const [stageF, setStageF] = useState("all");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Client | null>(null);
  const [form, setForm] = useState<typeof BLANK>(BLANK);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return items.filter((c) =>
      (stageF === "all" || c.stage === stageF) &&
      (!s || (c.name + " " + (c.email ?? "") + " " + (c.notes ?? "")).toLowerCase().includes(s))
    );
  }, [items, q, stageF]);

  function openNew() { setEditing(null); setForm(BLANK); setErr(""); setOpen(true); }
  function openEdit(c: Client) {
    setEditing(c);
    setForm({ name: c.name, type: c.type, stage: c.stage, email: c.email ?? "", notes: c.notes ?? "" });
    setErr(""); setOpen(true);
  }

  async function save() {
    if (!form.name.trim()) { setErr("Name is required."); return; }
    setBusy(true); setErr("");
    try {
      if (editing) await update(editing.id, form);
      else await create(form);
      setOpen(false);
    } catch { setErr("Could not save. Try again."); }
    finally { setBusy(false); }
  }

  return (
    <div className="mx-auto max-w-5xl p-4 md:p-8">
      <PageHeader
        eyebrow="Growth"
        title="Clients"
        subtitle="Managed accounts — residential, fleet, dealership, exotic, and commercial."
        action={<Button onClick={openNew}>+ Add client</Button>}
      />

      <Toolbar search={q} onSearch={setQ} placeholder="Search clients…">
        <select value={stageF} onChange={(e) => setStageF(e.target.value)}
          className="rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm outline-none focus:border-red-400 focus:ring-2 focus:ring-red-100">
          <option value="all">All stages</option>
          {CLIENT_STAGES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
      </Toolbar>

      {loading ? (
        <p className="text-sm text-neutral-400">Loading…</p>
      ) : filtered.length === 0 ? (
        <EmptyState title="No clients yet" hint="Add your first managed account to start tracking type, stage, and notes."
          action={<Button onClick={openNew}>+ Add client</Button>} />
      ) : (
        <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-neutral-100">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-500">
              <tr>
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Type</th>
                <th className="px-4 py-3 font-medium">Stage</th>
                <th className="hidden px-4 py-3 font-medium sm:table-cell">Email</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {filtered.map((c) => (
                <tr key={c.id} className="group cursor-pointer hover:bg-neutral-50" onClick={() => openEdit(c)}>
                  <td className="px-4 py-3">
                    <div className="font-medium text-neutral-900">{c.name}</div>
                    {c.notes && <div className="truncate text-xs text-neutral-400">{c.notes}</div>}
                    <Timestamp value={c.created_at} prefix="Added" />
                  </td>
                  <td className="px-4 py-3 text-neutral-600">{labelOf(CLIENT_TYPES, c.type)}</td>
                  <td className="px-4 py-3"><Tag color={colorOf(CLIENT_STAGES, c.stage)}>{labelOf(CLIENT_STAGES, c.stage)}</Tag></td>
                  <td className="hidden px-4 py-3 text-neutral-600 sm:table-cell">{c.email || "—"}</td>
                  <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                    <DeleteButton onClick={() => remove(c.id)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title={editing ? "Edit client" : "Add client"}
        footer={<>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={save} disabled={busy}>{busy ? "Saving…" : editing ? "Save" : "Add client"}</Button>
        </>}>
        <div className="space-y-3">
          <Field label="Name"><Input value={form.name} autoFocus onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Client or business name" /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Type"><Select options={CLIENT_TYPES} value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} /></Field>
            <Field label="Stage"><Select options={CLIENT_STAGES} value={form.stage} onChange={(e) => setForm({ ...form, stage: e.target.value })} /></Field>
          </div>
          <Field label="Email"><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="name@email.com" /></Field>
          <Field label="Notes"><Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Anything worth remembering…" /></Field>
          {err && <p className="text-sm text-rose-600">{err}</p>}
        </div>
      </Modal>
    </div>
  );
}
