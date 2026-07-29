import { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import { BOTTOM_NAV, BOTTOM_NAV_PRIMARY } from "../lib/nav";
import { api } from "../api";

/**
 * The phone tab bar.
 *
 * Five thumb-sized targets, the middle one raised because it is the action that
 * makes money. Everything sits above the iPhone home indicator via the
 * safe-area inset, and the Inbox carries a count of conversations where the
 * customer spoke last.
 */

function Icon({ d, size = 22 }: { d: string; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

function useUnreadCount(): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    let alive = true;
    const load = () => api<{ count: number }>("/api/messages/unread-count")
      .then((r) => { if (alive) setN(r.count); })
      .catch(() => {});
    load();
    // Cheap query, and a stale badge is worse than no badge.
    const t = setInterval(load, 60_000);
    return () => { alive = false; clearInterval(t); };
  }, []);
  return n;
}

export default function BottomNav({ onMore, moreOpen }: { onMore: () => void; moreOpen: boolean }) {
  const unread = useUnreadCount();

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 border-t border-neutral-200 bg-white/95 backdrop-blur md:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      aria-label="Main"
    >
      <div className="flex items-stretch">
        {BOTTOM_NAV.map((item, i) => {
          const isPrimary = i === BOTTOM_NAV_PRIMARY;
          const isInbox = item.to === "/inbox";

          if (isPrimary) {
            // Raised primary action — visually lifted out of the bar.
            return (
              <NavLink key={item.to} to={item.to} aria-label={item.label}
                className="relative flex flex-1 flex-col items-center justify-end pb-1.5 pt-1">
                {({ isActive }) => (
                  <>
                    <span className={`-mt-6 grid h-14 w-14 place-items-center rounded-full text-white shadow-lg ring-4 ring-white transition ${
                      isActive ? "bg-red-700" : "bg-gradient-to-b from-red-500 to-red-600"
                    }`}>
                      <Icon d={item.icon} size={26} />
                    </span>
                    <span className={`mt-1 text-[11px] font-medium ${isActive ? "text-red-600" : "text-neutral-500"}`}>
                      {item.short}
                    </span>
                  </>
                )}
              </NavLink>
            );
          }

          return (
            <NavLink key={item.to} to={item.to} aria-label={item.label}
              className={({ isActive }) =>
                `relative flex min-h-[56px] flex-1 flex-col items-center justify-center gap-1 text-[11px] ${
                  isActive ? "font-medium text-red-600" : "text-neutral-500"
                }`
              }>
              {({ isActive }) => (
                <>
                  <span className="relative">
                    <Icon d={item.icon} />
                    {isInbox && unread > 0 && (
                      <span className="absolute -right-2.5 -top-1.5 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-red-600 px-1 text-[10px] font-semibold text-white">
                        {unread > 9 ? "9+" : unread}
                      </span>
                    )}
                  </span>
                  {item.short}
                  {isActive && <span className="absolute inset-x-4 top-0 h-0.5 rounded-full bg-red-600" />}
                </>
              )}
            </NavLink>
          );
        })}

        {/* More — opens the full menu */}
        <button
          onClick={onMore}
          aria-label="More"
          aria-expanded={moreOpen}
          className={`relative flex min-h-[56px] flex-1 flex-col items-center justify-center gap-1 text-[11px] ${
            moreOpen ? "font-medium text-red-600" : "text-neutral-500"
          }`}
        >
          <Icon d="M4 6h16M4 12h16M4 18h16" />
          More
          {moreOpen && <span className="absolute inset-x-4 top-0 h-0.5 rounded-full bg-red-600" />}
        </button>
      </div>
    </nav>
  );
}
