import { useEffect, useMemo, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { NAV_GROUPS, NAV_ITEMS } from "../lib/nav";
import BottomNav from "./BottomNav";
import { BrandLogo } from "./ui";
import { useCommandPalette } from "./CommandPalette";

function SearchTrigger({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick}
      className="flex w-full items-center gap-2 rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-chrome-400 transition hover:border-white/20 hover:text-white">
      <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4-4" /></svg>
      <span>Search…</span>
      <kbd className="ml-auto rounded border border-white/10 px-1.5 py-0.5 text-[10px] text-chrome-400">⌘K</kbd>
    </button>
  );
}

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

function SidebarNav({ collapsed, query, onNavigate, touch = false, openGroups, onToggleGroup }: {
  collapsed: boolean;
  query: string;
  onNavigate?: () => void;
  /** Phone drawer: bigger rows and collapsible groups. */
  touch?: boolean;
  openGroups?: Set<string>;
  onToggleGroup?: (title: string) => void;
}) {
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
    <nav className={touch ? "space-y-1" : "space-y-5"}>
      {groups.map((g) => {
        // While searching every group opens, otherwise only the one you're in.
        const expanded = !touch || !!q || openGroups?.has(g.title);
        return (
          <div key={g.title}>
            {!collapsed && (touch ? (
              <button
                onClick={() => onToggleGroup?.(g.title)}
                className="flex min-h-[44px] w-full items-center justify-between rounded-lg px-3 text-left"
                aria-expanded={expanded}
              >
                <span className="eyebrow text-[10px] text-chrome-400/80">{g.title}</span>
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2"
                  className={`text-chrome-400 transition-transform ${expanded ? "rotate-180" : ""}`}>
                  <path d="M6 9l6 6 6-6" />
                </svg>
              </button>
            ) : (
              <div className="eyebrow mb-1.5 px-3 text-[9px] text-chrome-400/70">{g.title}</div>
            ))}
            {expanded && (
              <div className="space-y-0.5">
                {g.items.map((l) => (
                  <NavLink
                    key={l.to}
                    to={l.to}
                    title={collapsed ? l.label : undefined}
                    onClick={onNavigate}
                    className={({ isActive }) =>
                      `group relative flex items-center gap-3 rounded-lg px-3 transition ${touch ? "min-h-[48px] text-[15px]" : "py-2 text-sm"} ${collapsed ? "justify-center" : ""} ${
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
            )}
          </div>
        );
      })}
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
  const [drawerQuery, setDrawerQuery] = useState("");
  const loc = useLocation();
  const navigate = useNavigate();
  const openPalette = useCommandPalette();

  // Open the group you're currently in; the rest stay folded so the menu is
  // a short list rather than 24 rows to scroll past.
  const currentGroup = useMemo(
    () => NAV_GROUPS.find((g) => g.items.some((i) => loc.pathname.startsWith(i.to)))?.title,
    [loc.pathname]
  );
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (mobileOpen) setOpenGroups(new Set(currentGroup ? [currentGroup] : []));
  }, [mobileOpen, currentGroup]);

  const toggleGroup = (title: string) =>
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(title)) next.delete(title); else next.add(title);
      return next;
    });

  const hideTabBar = loc.pathname.startsWith("/quote-builder");

  const pageTitle = useMemo(
    () => NAV_ITEMS.find((i) => loc.pathname.startsWith(i.to))?.label ?? "BH Car Details",
    [loc.pathname]
  );

  useEffect(() => { localStorage.setItem("bh_sidebar_collapsed", collapsed ? "1" : "0"); }, [collapsed]);
  useEffect(() => { setMobileOpen(false); setDrawerQuery(""); }, [loc.pathname]); // close drawer on navigate

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
            <SearchTrigger onClick={openPalette} />
          </div>
        )}
        <div className="flex-1 overflow-y-auto px-2 pb-6">
          <SidebarNav collapsed={collapsed} query="" />
        </div>
      </aside>

      {/* Mobile drawer — opened from the More tab, so it stays under the thumb */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden" onClick={() => setMobileOpen(false)}>
          <div className="absolute inset-0 bg-graphite-950/70 backdrop-blur-sm" />
          <aside
            className={`absolute inset-y-0 left-0 flex w-80 max-w-[88%] flex-col shadow-2xl ${sidebarSurface}`}
            onClick={(e) => e.stopPropagation()}
            style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
          >
            <div className="flex items-center justify-between p-3">
              <Brand collapsed={false} />
              <button onClick={() => setMobileOpen(false)} aria-label="Close menu"
                className="grid h-11 w-11 place-items-center rounded-lg text-chrome-400 hover:bg-white/5">
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
              </button>
            </div>

            {/* Type to filter the menu; the magnifier opens full search. */}
            <div className="flex items-center gap-2 px-3 pb-3">
              <input
                value={drawerQuery}
                onChange={(e) => setDrawerQuery(e.target.value)}
                placeholder="Find a page…"
                aria-label="Find a page"
                className="min-h-[44px] w-full rounded-lg border border-white/10 bg-black/30 px-3 text-[15px] text-white placeholder:text-chrome-400 focus:border-white/25 focus:outline-none"
              />
              <button onClick={() => { setMobileOpen(false); openPalette(); }} aria-label="Search everything"
                className="grid h-11 w-11 shrink-0 place-items-center rounded-lg border border-white/10 bg-black/30 text-chrome-300">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4-4" /></svg>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-2 pb-4">
              <SidebarNav
                collapsed={false}
                query={drawerQuery}
                touch
                openGroups={openGroups}
                onToggleGroup={toggleGroup}
                onNavigate={() => setMobileOpen(false)}
              />
            </div>
          </aside>
        </div>
      )}

      <main className={`min-w-0 flex-1 md:pb-0 ${hideTabBar ? "" : "pb-[calc(5.5rem+env(safe-area-inset-bottom))]"}`}>
        {/* Mobile header: says where you are, and puts search one tap away
            instead of hiding it inside the menu. */}
        <header className={`sticky top-0 z-30 flex h-12 items-center gap-2 border-b border-white/5 px-2 md:hidden ${sidebarSurface}`}>
          {hideTabBar ? (
            // The tab bar is hidden here, and the installed app has no browser
            // back button — so this is the only way out. It must always exist.
            <button onClick={() => navigate("/home")} aria-label="Close and go home"
              className="grid h-10 w-10 shrink-0 place-items-center rounded-lg text-chrome-300 hover:bg-white/5">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
            </button>
          ) : (
            <BrandLogo h="h-6" chip className="ml-1 shrink-0" />
          )}
          <span className="truncate font-display tracking-wide text-white">{pageTitle}</span>
          <button onClick={openPalette} aria-label="Search"
            className="ml-auto grid h-10 w-10 place-items-center rounded-lg text-chrome-300 hover:bg-white/5">
            <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4-4" /></svg>
          </button>
        </header>
        <Outlet />
      </main>
      {/* The quote wizard owns the bottom of the screen — its own Continue bar
          would otherwise sit underneath the tab bar. It has Back at every step
          and exits to Home when it finishes, so nothing is trapped. */}
      {!hideTabBar && <BottomNav onMore={() => setMobileOpen(true)} moreOpen={mobileOpen} />}
    </div>
  );
}
