import { NavLink, Outlet } from "react-router-dom";

const links = [
  { to: "/dashboard", label: "Dashboard" },
  { to: "/contacts", label: "Contacts" },
];
const comingSoon = ["Pipeline", "Calendar", "Sequences", "Workflows", "Brand Brain"];

export default function Layout() {
  return (
    <div className="flex min-h-screen bg-neutral-100">
      <aside className="w-56 shrink-0 bg-neutral-950 p-4 text-neutral-300">
        <div className="mb-6 text-lg font-bold text-white">BH CRM</div>
        <nav className="space-y-1">
          {links.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              className={({ isActive }) =>
                `block rounded-md px-3 py-2 text-sm ${isActive ? "bg-red-600 text-white" : "hover:bg-neutral-800"}`
              }
            >
              {l.label}
            </NavLink>
          ))}
          {comingSoon.map((label) => (
            <span key={label} className="block cursor-not-allowed rounded-md px-3 py-2 text-sm text-neutral-600" title="Coming in a later phase">
              {label}
            </span>
          ))}
        </nav>
      </aside>
      <main className="min-w-0 flex-1">
        <Outlet />
      </main>
    </div>
  );
}
