import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { fullName, money, STAGES, type Contact, type Revenue, type Stats } from "../types";
import { useCollection } from "../lib/collections";
import { UpdateComposer, UpdateFeed, type UpdateRow } from "../components/UpdatesFeed";

function MonthBars({ series }: { series: Revenue["series"] }) {
  const rows = series ?? [];
  const max = Math.max(1, ...rows.map((r) => r.cents));
  const label = (ym: string) => {
    const [, m] = ym.split("-");
    return ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(m)] ?? ym;
  };
  if (rows.length === 0) return <p className="text-sm text-neutral-400">No completed jobs yet — revenue shows here once jobs are marked paid.</p>;
  return (
    <div className="flex items-end gap-3 pt-2" style={{ height: 120 }}>
      {rows.map((r) => (
        <div key={r.ym} className="flex flex-1 flex-col items-center gap-1">
          <div className="text-[10px] font-medium text-neutral-500">{money(r.cents)}</div>
          <div className="flex w-full items-end justify-center" style={{ height: 80 }}>
            <div className="w-8 rounded-t bg-red-600" style={{ height: `${Math.max(4, (r.cents / max) * 80)}px` }} title={`${money(r.cents)} · ${r.n} jobs`} />
          </div>
          <div className="text-[11px] text-neutral-500">{label(r.ym)}</div>
        </div>
      ))}
    </div>
  );
}

interface Digest { stats: Record<string, number>; narrative: string | null }

export default function Dashboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [newLeads, setNewLeads] = useState<Contact[]>([]);
  const [digest, setDigest] = useState<Digest | null>(null);
  const [digestBusy, setDigestBusy] = useState(false);
  const { items: updates, create: postUpdate, remove: removeUpdate } = useCollection<UpdateRow>("updates");

  useEffect(() => {
    api<Stats>("/api/stats").then(setStats).catch(() => {});
    api<{ items: Contact[] }>("/api/contacts?stage=new&limit=20").then((r) => setNewLeads(r.items)).catch(() => {});
  }, []);

  async function loadDigest() {
    setDigestBusy(true);
    try { setDigest(await api<Digest>("/api/ai/digest")); }
    catch { /* ignore */ }
    finally { setDigestBusy(false); }
  }

  return (
    <div className="space-y-8 p-4 md:p-8">
      <h1 className="text-2xl font-semibold">Dashboard</h1>

      {/* Quick post update */}
      <section className="space-y-4">
        <UpdateComposer onPost={(d) => postUpdate(d)} compact />
        {updates.length > 0 && (
          <div className="rounded-xl bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-medium text-neutral-600">Latest updates</h2>
              <Link to="/updates" className="text-xs font-medium text-red-600 hover:underline">View all →</Link>
            </div>
            <UpdateFeed items={updates} limit={3} onDelete={removeUpdate} />
          </div>
        )}
      </section>

      {/* Money influx */}
      <section className="space-y-4">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <div className="bh-gloss rounded-xl bg-gradient-to-br from-graphite-900 to-graphite-950 p-4 text-white shadow-sm ring-1 ring-white/5">
            <div className="eyebrow text-[10px] text-chrome-400">Revenue this month</div>
            <div className="mt-1 font-display text-3xl">{stats?.revenue ? money(stats.revenue.month_cents) : "—"}</div>
            <div className="mt-1 text-xs text-neutral-400">{stats?.revenue ? `${money(stats.revenue.week_cents)} this week` : ""}</div>
          </div>
          <div className="rounded-xl bg-white p-4 shadow-sm">
            <div className="text-xs uppercase tracking-wide text-neutral-500">Pipeline value</div>
            <div className="mt-1 font-display text-3xl text-red-600">{stats?.revenue ? money(stats.revenue.pipeline_cents) : "—"}</div>
            <div className="mt-1 text-xs text-neutral-500">{stats?.revenue ? `${stats.revenue.pipeline_jobs} open job${stats.revenue.pipeline_jobs === 1 ? "" : "s"}` : ""}</div>
          </div>
          <div className="rounded-xl bg-white p-4 shadow-sm">
            <div className="text-xs uppercase tracking-wide text-neutral-500">Avg ticket</div>
            <div className="mt-1 font-display text-3xl">{stats?.revenue ? money(stats.revenue.avg_ticket_cents) : "—"}</div>
            <div className="mt-1 text-xs text-neutral-500">across paid jobs</div>
          </div>
          <div className="rounded-xl bg-white p-4 shadow-sm">
            <div className="text-xs uppercase tracking-wide text-neutral-500">All-time revenue</div>
            <div className="mt-1 font-display text-3xl">{stats?.revenue ? money(stats.revenue.all_time_cents) : "—"}</div>
            <div className="mt-1 text-xs text-neutral-500">{stats?.revenue ? `${stats.revenue.jobs_paid_all} jobs paid` : ""}</div>
          </div>
        </div>
        <div className="rounded-xl bg-white p-4 shadow-sm">
          <h2 className="text-sm font-medium text-neutral-600">Revenue — last 6 months</h2>
          <MonthBars series={stats?.revenue?.series ?? []} />
        </div>
      </section>

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

      <section className="rounded-xl border border-amber-200 bg-amber-50 p-4">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 className="text-lg font-medium">Weekly digest</h2>
          <button onClick={loadDigest} disabled={digestBusy} className="min-h-[44px] rounded-md bg-neutral-900 px-3 text-sm text-white disabled:opacity-50">{digestBusy ? "Thinking…" : "✨ Generate"}</button>
        </div>
        {digest ? (
          <>
            {digest.narrative
              ? <p className="text-sm text-neutral-800">{digest.narrative}</p>
              : <p className="text-sm text-neutral-600">{digest.stats.new_leads} new leads · {digest.stats.jobs_scheduled} jobs scheduled · ${(digest.stats.quoted_cents / 100).toFixed(0)} quoted · {digest.stats.open_tasks} open tasks. <span className="text-neutral-400">(AI summary activates once your Anthropic key is added.)</span></p>}
          </>
        ) : (
          <p className="text-sm text-neutral-500">Tap Generate for this week's numbers and an AI recap.</p>
        )}
      </section>

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
