import { createContext, useContext, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { api } from "../api";
import { NAV_ITEMS } from "../lib/nav";
import { money } from "../types";

/**
 * Global search / command palette (⌘K, Ctrl+K). This is the app's real search:
 * it indexes navigation plus live data — contacts (server search), and revenue,
 * products & clients (loaded once and filtered client-side). The sidebar's
 * "Search…" control opens this via `useCommandPalette()`.
 */

type Kind = "nav" | "contact" | "revenue" | "product" | "client";
interface Result { key: string; kind: Kind; title: string; sub?: string; to: string }

const KIND_LABEL: Record<Kind, string> = {
  nav: "Go to", contact: "Contact", revenue: "Revenue", product: "Product", client: "Client",
};

const OpenCtx = createContext<() => void>(() => {});
export function useCommandPalette(): () => void { return useContext(OpenCtx); }

interface Row { id: string; [k: string]: unknown }

export function CommandPaletteProvider({ children }: { children: ReactNode }) {
  const loc = useLocation();
  const nav = useNavigate();
  const enabled = !/^\/(login|book|quote)/.test(loc.pathname);

  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const [contacts, setContacts] = useState<Row[]>([]);
  const cache = useRef<{ revenue: Row[]; products: Row[]; clients: Row[] } | null>(null);
  const [cacheV, setCacheV] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const openPalette = useCallback(() => { setQ(""); setActive(0); setOpen(true); }, []);
  const close = useCallback(() => setOpen(false), []);

  // Global hotkey.
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setQ(""); setActive(0); setOpen((o) => !o); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled]);

  useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 0); }, [open]);
  useEffect(() => { close(); }, [loc.pathname, close]);

  // Load searchable collections once, the first time the palette opens.
  useEffect(() => {
    if (!open || cache.current) return;
    Promise.all([
      api<{ items: Row[] }>("/api/c/revenue").then((r) => r.items).catch(() => []),
      api<{ items: Row[] }>("/api/c/products").then((r) => r.items).catch(() => []),
      api<{ items: Row[] }>("/api/c/clients").then((r) => r.items).catch(() => []),
    ]).then(([revenue, products, clients]) => { cache.current = { revenue, products, clients }; setCacheV((v) => v + 1); });
  }, [open]);

  // Debounced live contact search.
  useEffect(() => {
    if (!open) return;
    const term = q.trim();
    if (!term) { setContacts([]); return; }
    const t = setTimeout(() => {
      api<{ items: Row[] }>(`/api/contacts?search=${encodeURIComponent(term)}&limit=6`).then((r) => setContacts(r.items)).catch(() => {});
    }, 170);
    return () => clearTimeout(t);
  }, [q, open]);

  const results = useMemo<Result[]>(() => {
    const term = q.trim().toLowerCase();
    const out: Result[] = [];

    const navItems = term
      ? NAV_ITEMS.filter((i) => (i.label + " " + (i.keywords ?? "")).toLowerCase().includes(term))
      : NAV_ITEMS;
    for (const i of navItems.slice(0, term ? 6 : NAV_ITEMS.length)) {
      out.push({ key: `nav:${i.to}`, kind: "nav", title: i.label, to: i.to });
    }

    if (term) {
      for (const c of contacts) {
        const name = [c.first_name, c.last_name].filter(Boolean).join(" ") || (c.email as string) || "(no name)";
        const sub = [c.email, c.phone].filter(Boolean).join(" · ") || (c.stage as string);
        out.push({ key: `contact:${c.id}`, kind: "contact", title: name, sub, to: `/contacts/${c.id}` });
      }
      const c = cache.current;
      if (c) {
        for (const r of c.revenue.filter((r) => `${r.label ?? ""} ${r.customer ?? ""} ${r.service ?? ""}`.toLowerCase().includes(term)).slice(0, 5)) {
          out.push({ key: `rev:${r.id}`, kind: "revenue", title: String(r.label ?? "Revenue"), sub: [r.customer, money(Number(r.amount_cents) || 0)].filter(Boolean).join(" · "), to: "/revenue" });
        }
        for (const p of c.products.filter((p) => String(p.name ?? "").toLowerCase().includes(term)).slice(0, 5)) {
          out.push({ key: `prod:${p.id}`, kind: "product", title: String(p.name ?? "Product"), sub: p.price_cents ? money(Number(p.price_cents)) : undefined, to: "/products" });
        }
        for (const cl of c.clients.filter((cl) => String(cl.name ?? "").toLowerCase().includes(term)).slice(0, 5)) {
          out.push({ key: `client:${cl.id}`, kind: "client", title: String(cl.name ?? "Client"), sub: (cl.type as string) || undefined, to: "/clients" });
        }
      }
    }
    return out;
  }, [q, contacts, cacheV]);

  useEffect(() => { setActive(0); }, [q]);

  const go = useCallback((r?: Result) => { if (!r) return; close(); nav(r.to); }, [close, nav]);

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, results.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); go(results[active]); }
    else if (e.key === "Escape") { e.preventDefault(); close(); }
  }

  return (
    <OpenCtx.Provider value={openPalette}>
      {children}
      {open && enabled && (
        <div className="fixed inset-0 z-[90] flex items-start justify-center bg-graphite-950/50 p-4 pt-[12vh] backdrop-blur-sm" onMouseDown={close}>
          <div className="w-full max-w-xl overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-black/5"
            style={{ animation: "bh-pop-in 0.16s ease-out both" }} onMouseDown={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 border-b border-steel-100 px-4">
              <svg className="text-chrome-400" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4-4" /></svg>
              <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKeyDown}
                placeholder="Search contacts, revenue, products, or jump to a page…"
                className="w-full bg-transparent py-3.5 text-sm text-graphite-950 outline-none placeholder:text-chrome-400" />
              <kbd className="hidden rounded border border-steel-200 px-1.5 py-0.5 text-[10px] text-chrome-400 sm:block">esc</kbd>
            </div>
            <div className="max-h-[52vh] overflow-y-auto py-2">
              {results.length === 0 ? (
                <p className="px-4 py-8 text-center text-sm text-chrome-400">{q.trim() ? "No matches." : "Type to search."}</p>
              ) : (
                results.map((r, i) => (
                  <button key={r.key} onClick={() => go(r)} onMouseEnter={() => setActive(i)}
                    className={`flex w-full items-center gap-3 px-4 py-2.5 text-left ${i === active ? "bg-steel-100" : ""}`}>
                    <span className="w-16 shrink-0 text-[10px] font-semibold uppercase tracking-wide text-chrome-400">{KIND_LABEL[r.kind]}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-graphite-950">{r.title}</span>
                      {r.sub && <span className="block truncate text-xs text-chrome-400">{r.sub}</span>}
                    </span>
                    {i === active && <span className="shrink-0 text-[10px] text-chrome-400">↵</span>}
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </OpenCtx.Provider>
  );
}
