import { useEffect, useRef, useState } from "react";
import { api } from "../api";

/**
 * Customer field that links a revenue event (or anything) to a real contact.
 * Type to search existing contacts, pick one, or add a brand-new contact
 * inline. Leaving it as free text (no pick) is allowed for true one-offs —
 * the typed name is still captured as the display name.
 */
interface Hit { id: string; first_name: string | null; last_name: string | null; email: string | null; phone: string | null }
const nameOf = (h: Hit) => [h.first_name, h.last_name].filter(Boolean).join(" ") || h.email || h.phone || "(no name)";

export function ContactPicker({ contactId, name, onChange }: {
  contactId: string; name: string; onChange: (v: { contactId: string; name: string }) => void;
}) {
  const [q, setQ] = useState(name);
  const [hits, setHits] = useState<Hit[]>([]);
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { setQ(name); }, [name]);

  function search(v: string) {
    setQ(v); onChange({ contactId: "", name: v }); setOpen(true);
    if (timer.current) clearTimeout(timer.current);
    if (!v.trim()) { setHits([]); return; }
    timer.current = setTimeout(async () => {
      try { setHits((await api<{ items: Hit[] }>(`/api/contacts?search=${encodeURIComponent(v)}&limit=6`)).items); }
      catch { setHits([]); }
    }, 180);
  }
  function pick(h: Hit) { onChange({ contactId: h.id, name: nameOf(h) }); setQ(nameOf(h)); setOpen(false); setHits([]); }
  async function addNew() {
    const nm = q.trim(); if (!nm) return;
    setAdding(true);
    try {
      const [first, ...rest] = nm.split(" ");
      const r = await api<{ id: string }>("/api/contacts", { method: "POST", body: JSON.stringify({ first_name: first, last_name: rest.join(" ") }) });
      onChange({ contactId: r.id, name: nm }); setOpen(false); setHits([]);
    } finally { setAdding(false); }
  }

  if (contactId) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0 text-emerald-600"><path d="M9 15l6-6M10.5 6.5l1-1a3.5 3.5 0 015 5l-1 1M13.5 17.5l-1 1a3.5 3.5 0 01-5-5l1-1" /></svg>
        <span className="min-w-0 truncate font-medium text-emerald-800">{name}</span>
        <span className="text-xs text-emerald-600">linked</span>
        <button type="button" onClick={() => { onChange({ contactId: "", name: "" }); setQ(""); }} aria-label="Unlink" className="ml-auto shrink-0 text-emerald-500 hover:text-rose-500">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      <input value={q} onChange={(e) => search(e.target.value)} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder="Search a customer, or type a new name…"
        className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 outline-none placeholder:text-neutral-400 focus:border-red-400 focus:ring-2 focus:ring-red-100" />
      {open && q.trim() && (
        <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border border-steel-200 bg-white shadow-lg">
          {hits.map((h) => (
            <button key={h.id} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => pick(h)}
              className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-steel-50">
              <span className="min-w-0 truncate font-medium text-graphite-950">{nameOf(h)}</span>
              <span className="shrink-0 text-xs text-chrome-400">{h.email || h.phone}</span>
            </button>
          ))}
          <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={addNew} disabled={adding}
            className="flex w-full items-center gap-2 border-t border-steel-100 bg-steel-50/60 px-3 py-2 text-left text-sm text-red-600 hover:bg-steel-100 disabled:opacity-50">
            <span className="text-base leading-none">＋</span> {adding ? "Adding…" : <>Add “{q.trim()}” as new contact</>}
          </button>
        </div>
      )}
    </div>
  );
}
