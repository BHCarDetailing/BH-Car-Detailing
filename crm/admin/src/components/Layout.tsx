import { useEffect, useMemo, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { NAV_GROUPS } from "../lib/nav";
import BottomNav from "./BottomNav";

function NavIcon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

function Brand({ collapsed }: { collapsed: boolean }) {
  return (
    <div className={`flex items-center gap-2.5 ${collapsed ? "justify-center" : ""}`}>
      <img src="/brand/logo.png" alt="BH Car Detailing" className="h-9 w-auto shrink-0" />
      {!collapsed && (
        <div className="leading-tight">
          <div className="text-sm font-bold text-white">BH CRM</div>
          <div className="text-[11px] text-neutral-400">BH Car Details</div>
        </div>
      )}
    </div>
  );
}

function SidebarNav({ collapsed, query, onNavigate }: { collapsed: boolean; query: string; onNavigate?: () => void }) {
  const q = query.trim().toLowerCase();
  const groups = useMemo(() => {
    if (!q) return NAV_GROUPS;
    return NAV_GROUPS
      .map((g) => ({ ...g, items: g.items.filter((i) => (i.label + " " + (i.keywords ?? "")).toLowerCase().includes(q)) }))
      .filter((g) => g.items.length > 0);
  }, [q]);

  if (groups.length === 0) {
    return <p className="px-3 py-6 text-center text-xs text-neutral-500">No matches</p>;
  }

  return (
    <nav className="space-y-5">
      {groups.map((g) => (
        <div key={g.title}>
          {!collapsed && <div className="mb-1 px-3 text-[10px] font-semibold uppercase tracking-wider text-neutral-500">{g.title}</div>}
          <div className="space-y-0.5">
            {g.items.map((l) => (
              <NavLink
                key={l.to}
                to={l.to}
                title={collapsed ? l.label : undefined}
                onClick={onNavigate}
                className={({ isActive }) =>
                  `flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition ${collapsed ? "justify-center" : ""} ${
                    isActive ? "bg-red-600 font-medium text-white shadow-sm" : "text-neutral-300 hover:bg-neutral-800/70 hover:text-white"
                  }`
                }
              >
                <NavIcon d={l.icon} />
                {!collapsed && <span className="truncate">{l.label}</span>}
              </NavLink>
            ))}
          </div>
        </div>
      ))}
    </nav>
  );
}

function Hamburger({ onClick, label = "Toggle sidebar" }: { onClick: () => void; label?: string }) {
  return (
    <button onClick={onClick} aria-label={label}
      className="grid h-10 w-10 place-items-center rounded-lg text-neutral-300 hover:bg-neutral-800 hover:text-white">
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
    </button>
  );
}

export default function Layout() {
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem("bh_sidebar_collapsed") === "1");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [query, setQuery] = useState("");
  const loc = useLocation();

  useEffect(() => { localStorage.setItem("bh_sidebar_collapsed", collapsed ? "1" : "0"); }, [collapsed]);
  useEffect(() => { setMobileOpen(false); }, [loc.pathname]); // close drawer on navigate

  return (
    <div className="flex min-h-screen bg-neutral-100">
      {/* Desktop sidebar */}
      <aside className={`sticky top-0 hidden h-screen shrink-0 flex-col bg-neutral-950 md:flex ${collapsed ? "w-16" : "w-60"} transition-[width] duration-200`}>
        <div className={`flex items-center gap-1 p-3 ${collapsed ? "flex-col" : "justify-between"}`}>
          <Brand collapsed={collapsed} />
          <Hamburger onClick={() => setCollapsed((v) => !v)} label={collapsed ? "Expand sidebar" : "Collapse sidebar"} />
        </div>
        {!collapsed && (
          <div className="px-3 pb-2">
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search…"
              className="w-full rounded-lg bg-neutral-800/80 px-3 py-1.5 text-sm text-white placeholder-neutral-500 outline-none focus:ring-2 focus:ring-red-600" />
          </div>
        )}
        <div className="flex-1 overflow-y-auto px-2 pb-6">
          <SidebarNav collapsed={collapsed} query={query} />
        </div>
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden" onClick={() => setMobileOpen(false)}>
          <div className="absolute inset-0 bg-neutral-900/60 backdrop-blur-sm" />
          <aside className="absolute inset-y-0 left-0 flex w-72 max-w-[85%] flex-col bg-neutral-950 p-3 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-2 flex items-center justify-between">
              <Brand collapsed={false} />
              <button onClick={() => setMobileOpen(false)} aria-label="Close" className="grid h-9 w-9 place-items-center rounded-lg text-neutral-400 hover:bg-neutral-800">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
              </button>
            </div>
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search…"
              className="mb-3 w-full rounded-lg bg-neutral-800/80 px-3 py-2 text-sm text-white placeholder-neutral-500 outline-none focus:ring-2 focus:ring-red-600" />
            <div className="flex-1 overflow-y-auto px-1">
              <SidebarNav collapsed={false} query={query} onNavigate={() => setMobileOpen(false)} />
            </div>
          </aside>
        </div>
      )}

      <main className="min-w-0 flex-1 pb-16 md:pb-0">
        {/* Mobile top brand bar with hamburger */}
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-neutral-200 bg-neutral-950 px-3 md:hidden">
          <Hamburger onClick={() => setMobileOpen(true)} label="Open menu" />
          <img src="/brand/logo.png" alt="BH Car Detailing" className="h-8 w-auto" />
          <span className="text-sm font-semibold text-white">BH Car Details</span>
        </header>
        <Outlet />
      </main>
      <BottomNav />
    </div>
  );
}
