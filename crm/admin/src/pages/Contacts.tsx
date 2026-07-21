import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { fullName, STAGES, type Contact } from "../types";

export default function Contacts() {
  const [params, setParams] = useSearchParams();
  const [items, setItems] = useState<Contact[]>([]);
  const [total, setTotal] = useState(0);
  const search = params.get("search") ?? "";
  const stage = params.get("stage") ?? "";

  useEffect(() => {
    let stale = false;
    const q = new URLSearchParams();
    if (search) q.set("search", search);
    if (stage) q.set("stage", stage);
    q.set("limit", "100");
    api<{ items: Contact[]; total: number }>(`/api/contacts?${q}`)
      .then((r) => {
        if (stale) return;
        setItems(r.items);
        setTotal(r.total);
      })
      .catch(() => {});
    return () => {
      stale = true;
    };
  }, [search, stage]);

  function update(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  }

  return (
    <div className="space-y-4 p-4 md:p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Contacts <span className="text-base font-normal text-neutral-400">({total})</span></h1>
      </div>
      <div className="flex flex-wrap gap-3">
        <input
          value={search}
          onChange={(e) => update("search", e.target.value)}
          placeholder="Search name, email, phone…"
          className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-red-600 sm:w-72"
        />
        <select value={stage} onChange={(e) => update("stage", e.target.value)} className="rounded-md border border-neutral-300 px-3 py-2 text-sm">
          <option value="">All stages</option>
          {STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full rounded-xl bg-white text-sm shadow-sm">
        <thead>
          <tr className="border-b text-left text-neutral-500">
            <th className="p-3">Name</th><th className="p-3">Stage</th><th className="p-3">Phone</th>
            <th className="p-3">Email</th><th className="p-3">Source</th><th className="p-3">Created</th>
          </tr>
        </thead>
        <tbody>
          {items.map((c) => (
            <tr key={c.id} className="border-b last:border-0 hover:bg-neutral-50">
              <td className="p-3"><Link className="font-medium hover:underline" to={`/contacts/${c.id}`}>{fullName(c)}</Link></td>
              <td className="p-3 capitalize">{c.stage}</td>
              <td className="p-3">{c.phone && <a className="hover:underline" href={`sms:${c.phone}`}>{c.phone}</a>}</td>
              <td className="p-3">{c.email && <a className="hover:underline" href={`mailto:${c.email}`}>{c.email}</a>}</td>
              <td className="p-3">{c.source}</td>
              <td className="p-3">{new Date(c.created_at).toLocaleDateString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </div>
  );
}
