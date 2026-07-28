import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { fullName, STAGES, type Contact, type Label } from "../types";
import { PageHeader, Tag, Button, Modal, Field, Input, Select } from "../components/ui";
import { useToast } from "../components/Toast";

const NEW_CONTACT = { first_name: "", last_name: "", email: "", phone: "", stage: "new" };

const COLS: Array<{ key: string; label: string }> = [
  { key: "first_name", label: "Name" },
  { key: "stage", label: "Stage" },
  { key: "last_activity_at", label: "Last activity" },
  { key: "created_at", label: "Created" },
];

const STAGE_TAG: Record<string, string> = {
  new: "neutral", contacted: "blue", quoted: "amber", scheduled: "violet", customer: "green", lost: "red",
};
function initials(c: Contact): string {
  return [c.first_name, c.last_name].filter(Boolean).map((s) => s![0]).join("").slice(0, 2).toUpperCase() || "?";
}

export default function Contacts() {
  const [params, setParams] = useSearchParams();
  const [items, setItems] = useState<Contact[]>([]);
  const [total, setTotal] = useState(0);
  const [labels, setLabels] = useState<Label[]>([]);
  const [seqs, setSeqs] = useState<Array<{ id: string; name: string; status: string }>>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [reload, setReload] = useState(0);
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState(NEW_CONTACT);
  const [saving, setSaving] = useState(false);
  const [addErr, setAddErr] = useState("");

  async function saveContact() {
    if (!form.first_name.trim() && !form.email.trim() && !form.phone.trim()) {
      setAddErr("Add at least a name, email, or phone."); return;
    }
    setSaving(true); setAddErr("");
    try {
      await api("/api/contacts", { method: "POST", body: JSON.stringify(form) });
      setForm(NEW_CONTACT); setAddOpen(false); setReload((n) => n + 1);
    } catch { setAddErr("Couldn't save — try again."); }
    finally { setSaving(false); }
  }

  const toast = useToast();
  const search = params.get("search") ?? "";
  const stage = params.get("stage") ?? "";
  const tag = params.get("tag") ?? "";
  const archived = params.get("archived") === "1";
  const orderBy = params.get("order_by") ?? "created_at";
  const order = params.get("order") ?? "desc";

  const labelMap = useMemo(() => Object.fromEntries(labels.map((l) => [l.key, l])), [labels]);

  useEffect(() => {
    api<{ items: Label[] }>("/api/labels").then((r) => setLabels(r.items)).catch(() => {});
    api<{ items: Array<{ id: string; name: string; status: string }> }>("/api/sequences").then((r) => setSeqs(r.items.filter((s) => s.status === "active"))).catch(() => {});
  }, []);

  useEffect(() => {
    let stale = false;
    const q = new URLSearchParams();
    if (search) q.set("search", search);
    if (stage) q.set("stage", stage);
    if (tag) q.set("tag", tag);
    if (archived) q.set("archived", "1");
    q.set("order_by", orderBy);
    q.set("order", order);
    q.set("limit", "200");
    api<{ items: Contact[]; total: number }>(`/api/contacts?${q}`)
      .then((r) => { if (!stale) { setItems(r.items); setTotal(r.total); setSelected(new Set()); } })
      .catch(() => {});
    return () => { stale = true; };
  }, [search, stage, tag, archived, orderBy, order, reload]);

  async function archiveRow(c: Contact) {
    setItems((prev) => prev.filter((x) => x.id !== c.id));
    setTotal((t) => Math.max(0, t - 1));
    try { await api(`/api/contacts/${c.id}`, { method: "DELETE" }); }
    catch { setReload((n) => n + 1); return; }
    toast({
      message: `Archived ${fullName(c)}.`, actionLabel: "Undo", duration: 6000,
      onAction: async () => { await api(`/api/contacts/${c.id}/restore`, { method: "POST" }).catch(() => {}); setReload((n) => n + 1); },
    });
  }
  async function restoreRow(c: Contact) {
    setItems((prev) => prev.filter((x) => x.id !== c.id));
    try { await api(`/api/contacts/${c.id}/restore`, { method: "POST" }); }
    catch { setReload((n) => n + 1); return; }
    toast({ message: `Restored ${fullName(c)}.`, tone: "success" });
  }
  async function purgeRow(c: Contact) {
    if (!window.confirm(`Permanently delete ${fullName(c)}? This cannot be undone.`)) return;
    setItems((prev) => prev.filter((x) => x.id !== c.id));
    try { await api(`/api/contacts/${c.id}?purge=1`, { method: "DELETE" }); }
    catch { setReload((n) => n + 1); }
  }

  function update(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    setParams(next, { replace: true });
  }
  function sortBy(col: string) {
    const next = new URLSearchParams(params);
    next.set("order_by", col);
    next.set("order", orderBy === col && order === "asc" ? "desc" : "asc");
    setParams(next, { replace: true });
  }
  function toggle(id: string) {
    setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function toggleAll() {
    setSelected((s) => s.size === items.length ? new Set() : new Set(items.map((c) => c.id)));
  }
  async function bulk(op: string, value: string) {
    if (!value || selected.size === 0) return;
    await api("/api/contacts/bulk-action", { method: "POST", body: JSON.stringify({ ids: [...selected], op, value }) });
    setReload((n) => n + 1);
  }

  return (
    <div className="space-y-4 p-4 md:p-8 pb-24">
      <PageHeader eyebrow="Operations" title="Contacts" subtitle={`${total} ${total === 1 ? "person" : "people"} in your book`}
        action={<div className="flex gap-2">
          <Button onClick={() => { setForm(NEW_CONTACT); setAddErr(""); setAddOpen(true); }}>+ Add contact</Button>
          <Link to="/import" className="inline-flex min-h-[40px] items-center rounded-lg bg-graphite-950 px-4 text-sm font-medium text-white hover:bg-graphite-900">Import</Link>
        </div>} />

      <div className="flex flex-wrap gap-2">
        <div className="relative w-full sm:w-72">
          <svg className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-chrome-400" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4-4" /></svg>
          <input value={search} onChange={(e) => update("search", e.target.value)} placeholder="Search name, email, phone…" className="w-full rounded-lg border border-steel-200 bg-white py-2 pl-9 pr-3 text-sm outline-none focus:border-red-400 focus:ring-2 focus:ring-red-100" />
        </div>
        <select value={stage} onChange={(e) => update("stage", e.target.value)} className="rounded-lg border border-steel-200 bg-white px-3 py-2 text-sm capitalize outline-none focus:border-red-400">
          <option value="">All stages</option>
          {STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        {labels.length > 0 && (
          <select value={tag} onChange={(e) => update("tag", e.target.value)} className="rounded-lg border border-steel-200 bg-white px-3 py-2 text-sm outline-none focus:border-red-400">
            <option value="">All labels</option>
            {labels.map((l) => <option key={l.key} value={l.key}>{l.label}</option>)}
          </select>
        )}
        <button onClick={() => update("archived", archived ? "" : "1")}
          className={`rounded-lg border px-3 py-2 text-sm transition ${archived ? "border-graphite-800 bg-graphite-900 text-white" : "border-steel-200 bg-white text-chrome-400 hover:text-graphite-800"}`}>
          {archived ? "← Back to active" : "Archived"}
        </button>
      </div>

      <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-steel-200">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-steel-100 bg-steel-50 text-left text-xs uppercase tracking-wide text-chrome-400">
                <th className="p-3"><input type="checkbox" checked={items.length > 0 && selected.size === items.length} onChange={toggleAll} /></th>
                {COLS.map((col) => (
                  <th key={col.key} className="cursor-pointer select-none p-3 font-medium hover:text-graphite-800" onClick={() => sortBy(col.key)}>
                    {col.label}{orderBy === col.key ? (order === "asc" ? " ▲" : " ▼") : ""}
                  </th>
                ))}
                <th className="p-3 font-medium">Labels</th>
                <th className="p-3 font-medium">Phone</th>
                <th className="p-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-steel-100">
              {items.map((c) => (
                <tr key={c.id} className={`transition hover:bg-steel-50 ${selected.has(c.id) ? "bg-red-50" : ""}`}>
                  <td className="p-3"><input type="checkbox" checked={selected.has(c.id)} onChange={() => toggle(c.id)} /></td>
                  <td className="p-3">
                    <Link className="flex items-center gap-2.5 font-medium text-graphite-950 hover:text-red-600" to={`/contacts/${c.id}`}>
                      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-steel-100 text-[11px] font-bold text-chrome-400">{initials(c)}</span>
                      {fullName(c)}
                    </Link>
                  </td>
                  <td className="p-3"><Tag color={STAGE_TAG[c.stage] ?? "neutral"}>{c.stage}</Tag></td>
                  <td className="p-3 text-chrome-400">{c.last_activity_at ? new Date(c.last_activity_at).toLocaleDateString() : "—"}</td>
                  <td className="p-3 text-chrome-400">{new Date(c.created_at).toLocaleDateString()}</td>
                  <td className="p-3">
                    <div className="flex flex-wrap gap-1">
                      {(Array.isArray(c.tags) ? c.tags : []).map((t) => {
                        const l = labelMap[t];
                        return <span key={t} className="rounded-full px-2 py-0.5 text-[11px] text-white" style={{ backgroundColor: l?.color ?? "#6b7280" }}>{l?.label ?? t}</span>;
                      })}
                    </div>
                  </td>
                  <td className="p-3">{c.phone && <a className="text-neutral-600 hover:text-red-600" href={`sms:${c.phone}`}>{c.phone}</a>}</td>
                  <td className="p-3 text-right">
                    {archived ? (
                      <div className="flex justify-end gap-1.5">
                        <button onClick={() => restoreRow(c)} className="rounded-md bg-steel-100 px-2.5 py-1 text-xs font-medium text-graphite-800 hover:bg-steel-200">Restore</button>
                        <button onClick={() => purgeRow(c)} aria-label="Delete forever" className="grid h-7 w-7 place-items-center rounded-md text-neutral-300 hover:bg-rose-50 hover:text-rose-500">
                          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13" /></svg>
                        </button>
                      </div>
                    ) : (
                      <button onClick={() => archiveRow(c)} aria-label="Archive contact" className="grid h-7 w-7 place-items-center rounded-md text-neutral-300 hover:bg-rose-50 hover:text-rose-500">
                        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13" /></svg>
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {selected.size > 0 && (
        <div className="fixed inset-x-0 bottom-16 z-40 mx-auto flex max-w-3xl flex-wrap items-center gap-2 rounded-xl bg-neutral-900 p-3 text-sm text-white shadow-lg md:bottom-4">
          <span className="font-medium">{selected.size} selected</span>
          {labels.length > 0 && (
            <select onChange={(e) => { bulk("add_label", e.target.value); e.target.value = ""; }} defaultValue="" className="min-h-[40px] rounded-md bg-neutral-800 px-2">
              <option value="">＋ Add label…</option>
              {labels.map((l) => <option key={l.key} value={l.key}>{l.label}</option>)}
            </select>
          )}
          <select onChange={(e) => { bulk("set_stage", e.target.value); e.target.value = ""; }} defaultValue="" className="min-h-[40px] rounded-md bg-neutral-800 px-2">
            <option value="">Set stage…</option>
            {STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          {seqs.length > 0 && (
            <select onChange={(e) => { bulk("enroll_sequence", e.target.value); e.target.value = ""; }} defaultValue="" className="min-h-[40px] rounded-md bg-neutral-800 px-2">
              <option value="">Email this list…</option>
              {seqs.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          )}
          <button onClick={() => setSelected(new Set())} className="ml-auto text-neutral-400">Clear</button>
        </div>
      )}

      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Add contact"
        footer={<><Button variant="ghost" onClick={() => setAddOpen(false)}>Cancel</Button><Button onClick={saveContact} disabled={saving}>{saving ? "Saving…" : "Add contact"}</Button></>}>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="First name"><Input value={form.first_name} autoFocus onChange={(e) => setForm({ ...form, first_name: e.target.value })} placeholder="Jordan" /></Field>
            <Field label="Last name"><Input value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })} placeholder="Rivera" /></Field>
          </div>
          <Field label="Email"><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="name@email.com" /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Phone"><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+1 305…" /></Field>
            <Field label="Stage"><Select options={STAGES.map((s) => ({ value: s, label: s }))} value={form.stage} onChange={(e) => setForm({ ...form, stage: e.target.value })} /></Field>
          </div>
          <p className="text-xs text-chrome-400">Opted-in to email by default, so they can be enrolled in sequences right away.</p>
          {addErr && <p className="text-sm text-rose-600">{addErr}</p>}
        </div>
      </Modal>
    </div>
  );
}
