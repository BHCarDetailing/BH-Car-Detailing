import { useEffect, useMemo, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { NAV_GROUPS } from "../lib/nav";
import BottomNav from "./BottomNav";
import { BrandLogo } from "./ui";

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
      <BrandLogo h="h-8" chip className="shrink-0" />
      {!collapsed && (
        <div className="leading-none">
          <div className="font-display text-base tracking-wide text-white">BH CRM</div>
          <div className="eyebrow mt-0.5 text-[9px] text-chrome-400">BH Car Details</div>
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
    return <p className="px-3 py-6 text-center text-xs text-chrome-400">No matches</p>;
  }

  return (
    <nav className="space-y-5">
      {groups.map((g) => (
        <div key={g.title}>
          {!collapsed && <div className="eyebrow mb-1.5 px-3 text-[9px] text-chrome-400/70">{g.title}</div>}
          <div className="space-y-0.5">
            {g.items.map((l) => (
              <NavLink
                key={l.to}
                to={l.to}
                title={collapsed ? l.label : undefined}
                onClick={onNavigate}
                className={({ isActive }) =>
                  `group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition ${collapsed ? "justify-center" : ""} ${
                    isActive ? "bg-white/5 font-medium text-white" : "text-chrome-300 hover:bg-white/[0.04] hover:text-white"
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    {/* speed-bar active accent, lifted from the logo swoosh */}
                    <span className={`absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 -skew-y-12 rounded-r-sm bg-red-600 transition-opacity ${isActive ? "opacity-100" : "opacity-0"}`} />
                    <NavIcon d={l.icon} />
                    {!collapsed && <span className="truncate">{l.label}</span>}
                  </>
                )}
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
      className="grid h-10 w-10 place-items-center rounded-lg text-chrome-300 hover:bg-white/5 hover:text-white">
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

  const sidebarSurface = "bg-gradient-to-b from-graphite-900 to-graphite-950 bh-gloss";

  return (
    <div className="flex min-h-screen bg-steel-100">
      {/* Desktop sidebar */}
      <aside className={`sticky top-0 hidden h-screen shrink-0 flex-col border-r border-white/5 md:flex ${sidebarSurface} ${collapsed ? "w-16" : "w-60"} transition-[width] duration-200`}>
        <div className={`flex items-center gap-1 p-3 ${collapsed ? "flex-col" : "justify-between"}`}>
          <Brand collapsed={collapsed} />
          <Hamburger onClick={() => setCollapsed((v) => !v)} label={collapsed ? "Expand sidebar" : "Collapse sidebar"} />
        </div>
        {!collapsed && (
          <div className="px-3 pb-2">
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search…"
              className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-1.5 text-sm text-white placeholder-chrome-400 outline-none focus:border-red-500/50 focus:ring-2 focus:ring-red-600/30" />
          </div>
        )}
        <div className="flex-1 overflow-y-auto px-2 pb-6">
          <SidebarNav collapsed={collapsed} query={query} />
        </div>
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden" onClick={() => setMobileOpen(false)}>
          <div className="absolute inset-0 bg-graphite-950/70 backdrop-blur-sm" />
          <aside className={`absolute inset-y-0 left-0 flex w-72 max-w-[85%] flex-col p-3 shadow-2xl ${sidebarSurface}`} onClick={(e) => e.stopPropagation()}>
            <div className="mb-2 flex items-center justify-between">
              <Brand collapsed={false} />
              <button onClick={() => setMobileOpen(false)} aria-label="Close" className="grid h-9 w-9 place-items-center rounded-lg text-chrome-400 hover:bg-white/5">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
              </button>
            </div>
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search…"
              className="mb-3 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white placeholder-chrome-400 outline-none focus:border-red-500/50 focus:ring-2 focus:ring-red-600/30" />
            <div className="flex-1 overflow-y-auto px-1">
              <SidebarNav collapsed={false} query={query} onNavigate={() => setMobileOpen(false)} />
            </div>
          </aside>
        </div>
      )}

      <main className="min-w-0 flex-1 pb-16 md:pb-0">
        {/* Mobile top brand bar with hamburger */}
        <header className={`sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-white/5 px-3 md:hidden ${sidebarSurface}`}>
          <Hamburger onClick={() => setMobileOpen(true)} label="Open menu" />
          <BrandLogo h="h-7" chip />
          <span className="font-display tracking-wide text-white">BH Car Details</span>
        </header>
        <Outlet />
      </main>
      <BottomNav />
    </div>
  );
}
