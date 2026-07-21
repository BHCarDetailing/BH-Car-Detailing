import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { fullName, STAGES, type Contact, type Stats } from "../types";

export default function Dashboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [newLeads, setNewLeads] = useState<Contact[]>([]);

  useEffect(() => {
    api<Stats>("/api/stats").then(setStats).catch(() => {});
    api<{ items: Contact[] }>("/api/contacts?stage=new&limit=20").then((r) => setNewLeads(r.items)).catch(() => {});
  }, []);

  return (
    <div className="space-y-8 p-4 md:p-8">
      <h1 className="text-2xl font-semibold">Dashboard</h1>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        {STAGES.map((s) => (
          <Link key={s} to={`/contacts?stage=${s}`} className="rounded-xl bg-white p-4 shadow-sm hover:shadow">
            <div className="text-2xl font-bold">{stats?.byStage[s] ?? "–"}</div>
            <div className="text-sm capitalize text-neutral-500">{s}</div>
          </Link>
        ))}
      </div>

      {(stats?.todayJobs?.length ?? 0) > 0 && (
        <section>
          <h2 className="mb-3 text-lg font-medium">Today's jobs</h2>
          <ul className="divide-y rounded-xl bg-white shadow-sm">
            {stats!.todayJobs.map((j) => (
              <li key={j.id} className="flex items-center justify-between gap-3 p-3 text-sm">
                <Link to={`/contacts/${j.contact_id}`} className="min-w-0">
                  <span className="font-medium">{j.title}</span>{" "}
                  <span className="text-neutral-500">{[j.first_name, j.last_name].filter(Boolean).join(" ")}</span>
                </Link>
                <span className="shrink-0 text-neutral-500">{j.scheduled_start ? new Date(j.scheduled_start).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : ""}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {(stats?.openTasks?.length ?? 0) > 0 && (
        <section>
          <h2 className="mb-3 text-lg font-medium">Due tasks</h2>
          <ul className="divide-y rounded-xl bg-white shadow-sm">
            {stats!.openTasks.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-3 p-3 text-sm">
                <span className="min-w-0"><span className="font-medium">{t.title}</span>{t.contact_id && <span className="text-neutral-500"> · {[t.first_name, t.last_name].filter(Boolean).join(" ")}</span>}</span>
                <span className="shrink-0 text-neutral-400">{t.due_at ? new Date(t.due_at).toLocaleDateString() : ""}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2 className="mb-3 text-lg font-medium">New leads needing action</h2>
        {newLeads.length === 0 ? (
          <p className="text-neutral-500">No new leads. They'll appear here the moment a form is submitted.</p>
        ) : (
          <ul className="divide-y rounded-xl bg-white shadow-sm">
            {newLeads.map((c) => (
              <li key={c.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <Link to={`/contacts/${c.id}`} className="font-medium hover:underline">{fullName(c)}</Link>
                  <div className="truncate text-sm text-neutral-500">
                    {c.source ?? "unknown source"} · {new Date(c.created_at).toLocaleString()}
                  </div>
                </div>
                <div className="flex flex-wrap shrink-0 gap-2">
                  {c.phone && (
                    <>
                      <a href={`sms:${c.phone}`} className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm text-white">Text</a>
                      <a href={`tel:${c.phone}`} className="rounded-md bg-neutral-200 px-3 py-1.5 text-sm">Call</a>
                    </>
                  )}
                  {c.email && <a href={`mailto:${c.email}`} className="rounded-md bg-neutral-200 px-3 py-1.5 text-sm">Email</a>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-lg font-medium">Recent activity</h2>
        <ul className="divide-y rounded-xl bg-white shadow-sm">
          {(stats?.recent ?? []).map((a) => (
            <li key={a.id} className="p-3 text-sm">
              <Link to={`/contacts/${a.contact_id}`} className="font-medium hover:underline">
                {[a.first_name, a.last_name].filter(Boolean).join(" ") || "(no name)"}
              </Link>{" "}
              — {a.title}
              <span className="ml-2 text-neutral-400">{new Date(a.created_at).toLocaleString()}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
