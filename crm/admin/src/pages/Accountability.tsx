import { useMemo, useState } from "react";
import { PageHeader, Tag, DeleteButton, Button } from "../components/ui";
import { useCollection, ACCT_BUCKETS, ACCT_STATUS, labelOf, colorOf, type Row } from "../lib/collections";
import { startOfWeek, addDays, fmtDate } from "../lib/datetime";

interface Task extends Row {
  title: string; bucket: string; status: string; progress: number; owner: string | null; due_date: string | null; created_at: string;
}

const STATUS_ORDER: Record<string, number> = { needs_attention: 0, flagged: 1, started: 2, not_started: 3, done: 4 };

const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** Real dated header for each bucket, derived from now(). */
function bucketDates(bucket: string): { title: string; sub: string } {
  const now = new Date();
  if (bucket === "today") {
    return { title: "Today", sub: new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric" }).format(now) };
  }
  if (bucket === "week") {
    const s = startOfWeek(now); const e = addDays(s, 6);
    return { title: "This week", sub: `Week of ${fmtDate(s).replace(/, \d{4}$/, "")} – ${fmtDate(e).replace(/, \d{4}$/, "")}` };
  }
  if (bucket === "month") {
    return { title: "This month", sub: `${MONTHS_LONG[now.getMonth()]} ${now.getFullYear()}` };
  }
  return { title: "Wins", sub: "Log completed goals" };
}

function MomentumBar({ pct }: { pct: number }) {
  return (
    <div className="bh-gloss relative overflow-hidden rounded-2xl bg-gradient-to-br from-graphite-900 to-graphite-950 p-5 text-white shadow-sm ring-1 ring-white/5">
      <div className="flex items-baseline justify-between">
        <div className="eyebrow text-[10px] text-chrome-400">Momentum</div>
        <div className="font-display text-3xl leading-none">{pct}%</div>
      </div>
      <div className="mt-3 h-2.5 w-full overflow-hidden rounded-full bg-white/10">
        <div className="bh-shine relative h-full overflow-hidden rounded-full bg-gradient-to-r from-red-600 to-red-400"
          style={{ width: `${pct}%`, transformOrigin: "left", animation: "bh-bar 0.6s ease-out both" }} />
      </div>
      <div className="mt-2 text-xs text-chrome-400">Average completion across active goals</div>
    </div>
  );
}

export default function Accountability() {
  const { items, loading, create, update, remove } = useCollection<Task>("acct_tasks");
  const [title, setTitle] = useState("");
  const [bucket, setBucket] = useState("today");

  const momentum = useMemo(() => {
    const active = items.filter((t) => t.bucket !== "wins");
    if (active.length === 0) return 0;
    const sum = active.reduce((a, t) => a + (t.status === "done" ? 100 : t.progress ?? 0), 0);
    return Math.round(sum / active.length);
  }, [items]);

  const winsThisMonth = useMemo(() => {
    const now = new Date();
    return items.filter((t) => {
      if (t.bucket !== "wins") return false;
      const d = new Date(t.created_at);
      return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
    }).length;
  }, [items]);

  const byBucket = useMemo(() => {
    const map: Record<string, Task[]> = { today: [], week: [], month: [], wins: [] };
    for (const t of items) (map[t.bucket] ?? map.today).push(t);
    for (const k of Object.keys(map)) {
      map[k].sort((a, b) => (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9));
    }
    return map;
  }, [items]);

  async function add() {
    const t = title.trim();
    if (!t) return;
    await create({ title: t, bucket, status: "not_started", progress: 0 });
    setTitle("");
  }

  function pushWeek(t: Task) {
    const base = t.due_date ? new Date(t.due_date) : new Date();
    base.setDate(base.getDate() + 7);
    update(t.id, { due_date: base.toISOString().slice(0, 10) });
  }

  function setStatus(t: Task, status: string) {
    update(t.id, status === "done" ? { status, progress: 100 } : { status });
  }
  function setProgress(t: Task, progress: number) {
    update(t.id, progress === 100 ? { progress, status: "done" } : { progress, status: t.status === "done" ? "started" : t.status });
  }

  return (
    <div className="mx-auto max-w-5xl p-4 md:p-8">
      <PageHeader eyebrow="Performance" title="Accountability" subtitle="What's getting done today, this week, this month — and the wins." />

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <div className="sm:col-span-2"><MomentumBar pct={momentum} /></div>
        <div className="bh-gloss flex flex-col justify-center rounded-2xl bg-gradient-to-br from-red-600 to-red-700 p-5 text-white shadow-sm ring-1 ring-white/10">
          <div className="eyebrow text-[10px] text-white/70">Wins this month</div>
          <div className="font-display mt-1 text-5xl leading-none">{winsThisMonth}</div>
          <div className="mt-1 text-xs text-white/70">completed goals in {new Intl.DateTimeFormat("en-US", { month: "long" }).format(new Date())}</div>
        </div>
      </div>

      {/* Add task */}
      <div className="mb-6 flex flex-wrap gap-2 rounded-2xl bg-white p-3 shadow-sm ring-1 ring-neutral-100">
        <input value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()}
          placeholder="Add a goal or task…" className="min-w-[180px] flex-1 rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-red-400 focus:ring-2 focus:ring-red-100" />
        <select value={bucket} onChange={(e) => setBucket(e.target.value)} className="rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-red-400">
          {ACCT_BUCKETS.map((b) => <option key={b.value} value={b.value}>{b.label}</option>)}
        </select>
        <Button onClick={add} disabled={!title.trim()}>Add</Button>
      </div>

      {loading ? <p className="text-sm text-neutral-400">Loading…</p> : (
        <div className="space-y-6">
          {ACCT_BUCKETS.map((b) => {
            const rows = byBucket[b.value] ?? [];
            const isWins = b.value === "wins";
            const hd = bucketDates(b.value);
            return (
              <section key={b.value}>
                <div className="mb-2 flex items-baseline gap-2">
                  <h2 className="text-sm font-semibold uppercase tracking-wider text-graphite-800">{hd.title}</h2>
                  <span className="text-xs text-chrome-400">{hd.sub}</span>
                  <span className="ml-auto rounded-full bg-steel-100 px-2 py-0.5 text-xs text-chrome-400">{rows.length}</span>
                </div>
                {rows.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-neutral-200 px-4 py-5 text-center text-xs text-neutral-400">
                    {isWins ? "Log wins here as goals get completed." : "Nothing here yet."}
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {rows.map((t) => (
                      <li key={t.id} className={`rounded-xl bg-white p-3 shadow-sm ring-1 ring-neutral-100 ${t.status === "done" ? "opacity-70" : ""}`}>
                        <div className="flex flex-wrap items-center gap-3">
                          <span className={`min-w-[160px] flex-1 text-sm ${t.status === "done" ? "text-neutral-400 line-through" : "text-neutral-800"}`}>{t.title}</span>

                          {!isWins && (
                            <div className="flex items-center gap-1">
                              {[0, 50, 100].map((p) => (
                                <button key={p} onClick={() => setProgress(t, p)}
                                  className={`h-7 rounded-md px-2 text-xs font-medium ring-1 ring-inset ${((t.status === "done" ? 100 : t.progress) === p) ? "bg-red-600 text-white ring-red-600" : "bg-white text-neutral-500 ring-neutral-200 hover:bg-neutral-50"}`}>
                                  {p}%
                                </button>
                              ))}
                            </div>
                          )}

                          <select value={t.status} onChange={(e) => setStatus(t, e.target.value)}
                            className="h-8 rounded-lg border border-neutral-200 bg-white px-2 text-xs outline-none focus:border-red-400">
                            {ACCT_STATUS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                          </select>

                          <Tag color={colorOf(ACCT_STATUS, t.status)}>{labelOf(ACCT_STATUS, t.status)}</Tag>

                          {!isWins && (
                            <button onClick={() => pushWeek(t)} title="Push to next week"
                              className="h-8 rounded-lg px-2 text-xs text-neutral-500 ring-1 ring-inset ring-neutral-200 hover:bg-neutral-50">
                              Push →
                            </button>
                          )}
                          {t.due_date && <span className="text-xs text-neutral-400">{new Date(t.due_date).toLocaleDateString()}</span>}
                          <DeleteButton onClick={() => remove(t.id)} />
                        </div>
                        {!isWins && (t.progress ?? 0) > 0 && t.status !== "done" && (
                          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-neutral-100">
                            <div className="h-full rounded-full bg-red-500" style={{ width: `${t.progress}%` }} />
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
