import { useMemo } from "react";
import { Link } from "react-router-dom";
import { PageHeader } from "../components/ui";
import { UpdateComposer, UpdateFeed, type UpdateRow } from "../components/UpdatesFeed";
import { useCollection, type Row } from "../lib/collections";

interface Task extends Row { bucket: string; status: string; progress: number }

const QUICK_LINKS = [
  { to: "/accountability", label: "Accountability", desc: "Today's goals", icon: "M9 11l3 3 6-6M21 12a9 9 0 11-6.2-8.5" },
  { to: "/clients", label: "Clients", desc: "Manage accounts", icon: "M4 8h16v11H4zM9 8V6a3 3 0 016 0v2" },
  { to: "/revenue", label: "Revenue", desc: "ARR · MRR · pipeline", icon: "M12 3v18M8 7h6a3 3 0 010 6H8m0 0h8" },
  { to: "/ask", label: "Ask Claude", desc: "Operations copilot", icon: "M12 3l1.8 4.7L18.5 9l-4.7 1.8L12 15l-1.8-4.2L5.5 9z" },
];

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

export default function Home() {
  const { items: updates, create } = useCollection<UpdateRow>("updates");
  const { items: tasks } = useCollection<Task>("acct_tasks");
  const { items: clients } = useCollection("clients");

  const momentum = useMemo(() => {
    const active = tasks.filter((t) => t.bucket !== "wins");
    if (active.length === 0) return 0;
    return Math.round(active.reduce((a, t) => a + (t.status === "done" ? 100 : t.progress ?? 0), 0) / active.length);
  }, [tasks]);

  const openTasks = tasks.filter((t) => t.bucket !== "wins" && t.status !== "done").length;
  const updatesThisWeek = updates.filter((u) => Date.now() - new Date(u.created_at).getTime() < 7 * 86400000).length;

  const stats = [
    { label: "Active clients", value: clients.length, to: "/clients" },
    { label: "Open goals", value: openTasks, to: "/accountability" },
    { label: "Momentum", value: `${momentum}%`, to: "/accountability" },
    { label: "Updates this week", value: updatesThisWeek, to: "/updates" },
  ];

  return (
    <div className="mx-auto max-w-4xl p-4 md:p-8">
      {/* Branded hero */}
      <div className="bh-bg relative mb-6 overflow-hidden rounded-3xl px-6 py-8 md:px-8 md:py-10">
        <div className="relative z-10 flex items-center gap-4">
          <div className="bh-shine relative overflow-hidden">
            <img src="/brand/logo-light.png" alt="BH Car Detailing" className="bh-float h-16 w-auto drop-shadow-[0_6px_20px_rgba(200,16,46,0.4)]" />
          </div>
          <div>
            <div className="eyebrow text-[10px] text-chrome-400">BH Car Details · Operating System</div>
            <h1 className="font-display mt-1 text-3xl leading-none text-white md:text-4xl">{greeting()}</h1>
          </div>
        </div>
      </div>

      {/* Quick stats */}
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stats.map((s) => (
          <Link key={s.label} to={s.to} className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-neutral-100 transition hover:shadow">
            <div className="font-display text-3xl leading-none text-graphite-950">{s.value}</div>
            <div className="mt-1 text-xs text-chrome-400">{s.label}</div>
          </Link>
        ))}
      </div>

      {/* Quick links */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {QUICK_LINKS.map((l) => (
          <Link key={l.to} to={l.to} className="group rounded-2xl bg-white p-4 shadow-sm ring-1 ring-neutral-100 transition hover:ring-red-200">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-red-50 text-red-600">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={l.icon} /></svg>
            </div>
            <div className="mt-3 text-sm font-semibold text-neutral-900">{l.label}</div>
            <div className="text-xs text-neutral-400">{l.desc}</div>
          </Link>
        ))}
      </div>

      {/* Post update + recent feed */}
      <PageHeader title="What's happening" subtitle="Post a quick update or catch up on the latest." />
      <div className="mb-5"><UpdateComposer onPost={(d) => create(d)} /></div>
      <UpdateFeed items={updates} limit={6} />
    </div>
  );
}
