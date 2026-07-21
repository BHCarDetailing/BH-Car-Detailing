import { NavLink } from "react-router-dom";
import { NAV_ITEMS } from "../lib/nav";

export default function BottomNav() {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 flex border-t border-neutral-200 bg-white md:hidden">
      {NAV_ITEMS.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          className={({ isActive }) =>
            `flex flex-1 flex-col items-center gap-1 py-2 text-[11px] ${
              isActive ? "text-red-600" : "text-neutral-500"
            }`
          }
        >
          <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d={item.icon} />
          </svg>
          {item.short}
        </NavLink>
      ))}
    </nav>
  );
}
