import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { fullName, STAGES, type Contact, type Label } from "../types";
import { PageHeader, Tag } from "../components/ui";

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
      <PageHeader eyebrow="Operations" title="Contacts" subtitle={`${total} ${total === 1 ? "person" : "people"} in your book`}
        action={<Link to="/import" className="inline-flex min-h-[40px] items-center rounded-lg bg-graphite-950 px-4 text-sm font-medium text-white hover:bg-graphite-900">Import</Link>} />

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
    </div>
  );
}
