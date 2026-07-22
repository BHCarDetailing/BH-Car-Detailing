import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { fullName, STAGES, type Contact, type Label } from "../types";

const COLS: Array<{ key: string; label: string }> = [
  { key: "first_name", label: "Name" },
  { key: "stage", label: "Stage" },
  { key: "last_activity_at", label: "Last activity" },
  { key: "created_at", label: "Created" },
];

export default function Contacts() {
  const [params, setParams] = useSearchParams();
  const [items, setItems] = useState<Contact[]>([]);
  const [total, setTotal] = useState(0);
  const [labels, setLabels] = useState<Label[]>([]);
  const [seqs, setSeqs] = useState<Array<{ id: string; name: string; status: string }>>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [reload, setReload] = useState(0);

  const search = params.get("search") ?? "";
  const stage = params.get("stage") ?? "";
  const tag = params.get("tag") ?? "";
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
    q.set("order_by", orderBy);
    q.set("order", order);
    q.set("limit", "200");
    api<{ items: Contact[]; total: number }>(`/api/contacts?${q}`)
      .then((r) => { if (!stale) { setItems(r.items); setTotal(r.total); setSelected(new Set()); } })
      .catch(() => {});
    return () => { stale = true; };
  }, [search, stage, tag, orderBy, order, reload]);

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
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Contacts <span className="text-base font-normal text-neutral-400">({total})</span></h1>
        <Link to="/import" className="min-h-[44px] rounded-md bg-neutral-900 px-4 py-2 text-sm text-white">Import</Link>
      </div>

      <div className="flex flex-wrap gap-3">
        <input value={search} onChange={(e) => update("search", e.target.value)} placeholder="Search name, email, phone…" className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-red-600 sm:w-72" />
        <select value={stage} onChange={(e) => update("stage", e.target.value)} className="rounded-md border border-neutral-300 px-3 py-2 text-sm">
          <option value="">All stages</option>
          {STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        {labels.length > 0 && (
          <select value={tag} onChange={(e) => update("tag", e.target.value)} className="rounded-md border border-neutral-300 px-3 py-2 text-sm">
            <option value="">All labels</option>
            {labels.map((l) => <option key={l.key} value={l.key}>{l.label}</option>)}
          </select>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full rounded-xl bg-white text-sm shadow-sm">
          <thead>
            <tr className="border-b text-left text-neutral-500">
              <th className="p-3"><input type="checkbox" checked={items.length > 0 && selected.size === items.length} onChange={toggleAll} /></th>
              {COLS.map((col) => (
                <th key={col.key} className="cursor-pointer select-none p-3" onClick={() => sortBy(col.key)}>
                  {col.label}{orderBy === col.key ? (order === "asc" ? " ▲" : " ▼") : ""}
                </th>
              ))}
              <th className="p-3">Labels</th>
              <th className="p-3">Phone</th>
            </tr>
          </thead>
          <tbody>
            {items.map((c) => (
              <tr key={c.id} className={`border-b last:border-0 hover:bg-neutral-50 ${selected.has(c.id) ? "bg-red-50" : ""}`}>
                <td className="p-3"><input type="checkbox" checked={selected.has(c.id)} onChange={() => toggle(c.id)} /></td>
                <td className="p-3"><Link className="font-medium hover:underline" to={`/contacts/${c.id}`}>{fullName(c)}</Link></td>
                <td className="p-3 capitalize">{c.stage}</td>
                <td className="p-3 text-neutral-500">{c.last_activity_at ? new Date(c.last_activity_at).toLocaleDateString() : "—"}</td>
                <td className="p-3 text-neutral-500">{new Date(c.created_at).toLocaleDateString()}</td>
                <td className="p-3">
                  <div className="flex flex-wrap gap-1">
                    {(c.tags ?? []).map((t) => {
                      const l = labelMap[t];
                      return <span key={t} className="rounded-full px-2 py-0.5 text-[11px] text-white" style={{ backgroundColor: l?.color ?? "#6b7280" }}>{l?.label ?? t}</span>;
                    })}
                  </div>
                </td>
                <td className="p-3">{c.phone && <a className="hover:underline" href={`sms:${c.phone}`}>{c.phone}</a>}</td>
              </tr>
            ))}
          </tbody>
        </table>
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
    </div>
  );
}
