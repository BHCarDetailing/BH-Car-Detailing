import { NavLink, Outlet } from "react-router-dom";
import { NAV_ITEMS } from "../lib/nav";
import BottomNav from "./BottomNav";

export default function Layout() {
  return (
    <div className="flex min-h-screen bg-neutral-100">
      <aside className="hidden w-56 shrink-0 bg-neutral-950 p-4 text-neutral-300 md:block">
        <div className="mb-6 flex items-center gap-2">
          <img src="/brand/logo.png" alt="BH Car Detailing" className="h-9 w-auto" />
          <span className="text-lg font-bold text-white">BH CRM</span>
        </div>
        <nav className="space-y-1">
          {NAV_ITEMS.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-md px-3 py-2 text-sm ${isActive ? "bg-red-600 text-white" : "hover:bg-neutral-800"}`
              }
            >
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d={l.icon} />
              </svg>
              {l.label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <main className="min-w-0 flex-1 pb-16 md:pb-0">
        {/* Mobile top brand bar */}
        <header className="sticky top-0 z-30 flex h-14 items-center justify-center border-b border-neutral-200 bg-neutral-950 md:hidden">
          <img src="/brand/logo.png" alt="BH Car Detailing" className="h-8 w-auto" />
        </header>
        <Outlet />
      </main>
      <BottomNav />
    </div>
  );
}
