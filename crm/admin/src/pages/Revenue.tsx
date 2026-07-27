import { useMemo, useState } from "react";
import { PageHeader, Button, Modal, Field, Input, Select, EmptyState, Tag, DeleteButton, StatTile, Tabs } from "../components/ui";
import { LineChart, Delta, type Point } from "../components/charts";
import { useCollection, REVENUE_STATUS, labelOf, colorOf, type Row } from "../lib/collections";
import { money } from "../types";
import { ymd, startOfWeek, fmtDate } from "../lib/datetime";

interface Entry extends Row {
  label: string; amount_cents: number; occurred_at: string | null; customer: string | null;
  service: string | null; status: string; note: string | null; created_at: string;
}

interface Product extends Row { name: string }

type Gran = "weekly" | "monthly" | "quarterly" | "yearly";
const GRAN_TABS = [
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "yearly", label: "Yearly" },
] as const;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function bucketKey(d: Date, g: Gran): string {
  const y = d.getFullYear();
  if (g === "yearly") return `${y}`;
  if (g === "quarterly") return `${y}-Q${Math.floor(d.getMonth() / 3) + 1}`;
  if (g === "monthly") return `${y}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  return ymd(startOfWeek(d)); // weekly
}
function bucketLabel(d: Date, g: Gran): string {
  const y = d.getFullYear();
  if (g === "yearly") return `${y}`;
  if (g === "quarterly") return `Q${Math.floor(d.getMonth() / 3) + 1} ${y}`;
  if (g === "monthly") return `${MONTHS[d.getMonth()]} ${y}`;
  const s = startOfWeek(d);
  return `${MONTHS[s.getMonth()]} ${s.getDate()}`;
}
/** Trailing periods ending now, oldest→newest. */
function trailingPeriods(g: Gran): { key: string; label: string; date: Date }[] {
  const out: { key: string; label: string; date: Date }[] = [];
  const now = new Date();
  const count = g === "weekly" ? 8 : g === "monthly" ? 12 : g === "quarterly" ? 8 : 5;
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(now);
    if (g === "weekly") d.setDate(d.getDate() - i * 7);
    else if (g === "monthly") d.setMonth(d.getMonth() - i);
    else if (g === "quarterly") d.setMonth(d.getMonth() - i * 3);
    else d.setFullYear(d.getFullYear() - i);
    out.push({ key: bucketKey(d, g), label: bucketLabel(d, g), date: d });
  }
  return out;
}

const BLANK = { label: "", amount: "", occurred_at: ymd(new Date()), customer: "", service: "", status: "paid", note: "" };

export default function Revenue() {
  const { items, loading, create, remove } = useCollection<Entry>("revenue");
  const { items: products } = useCollection<Product>("products");
  const [gran, setGran] = useState<Gran>("monthly");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<typeof BLANK>(BLANK);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const when = (e: Entry) => new Date(e.occurred_at ?? e.created_at);
  const realized = useMemo(() => items.filter((e) => e.status === "paid"), [items]);

  // Bucket realized revenue into the selected granularity's trailing periods.
  const periods = useMemo(() => trailingPeriods(gran), [gran]);
  const totalsByKey = useMemo(() => {
    const m: Record<string, { cents: number; n: number; amounts: number[] }> = {};
    for (const e of realized) {
      const k = bucketKey(when(e), gran);
      (m[k] ??= { cents: 0, n: 0, amounts: [] });
      m[k].cents += e.amount_cents; m[k].n += 1; m[k].amounts.push(e.amount_cents);
    }
    return m;
  }, [realized, gran]);

  const chart: Point[] = periods.map((p) => ({ label: p.label, value: (totalsByKey[p.key]?.cents ?? 0) / 100 }));
  const curKey = periods[periods.length - 1]?.key;
  const prevKey = periods[periods.length - 2]?.key;
  const cur = totalsByKey[curKey] ?? { cents: 0, n: 0, amounts: [] };
  const prevCents = totalsByKey[prevKey]?.cents ?? 0;
  const avg = cur.n ? Math.round(cur.cents / cur.n) : 0;
  const high = cur.amounts.length ? Math.max(...cur.amounts) : 0;
  const low = cur.amounts.length ? Math.min(...cur.amounts) : 0;
  const periodWord = gran === "weekly" ? "week" : gran === "monthly" ? "month" : gran === "quarterly" ? "quarter" : "year";

  const pending = useMemo(() => items.filter((e) => e.status === "pending").reduce((a, e) => a + e.amount_cents, 0), [items]);

  async function save() {
    const cents = Math.round(parseFloat(form.amount) * 100);
    if (!form.label.trim()) { setErr("Add a label."); return; }
    if (!Number.isFinite(cents) || cents < 0) { setErr("Enter a valid amount."); return; }
    setBusy(true); setErr("");
    try {
      await create({
        label: form.label, amount_cents: cents, occurred_at: form.occurred_at,
        customer: form.customer, service: form.service, status: form.status, note: form.note,
      });
      setForm({ ...BLANK, occurred_at: form.occurred_at }); setOpen(false);
    } catch { setErr("Could not save."); }
    finally { setBusy(false); }
  }

  return (
    <div className="mx-auto max-w-5xl p-4 md:p-8">
      <PageHeader eyebrow="Growth" title="Revenue Events" subtitle="Every sale, dated and tracked — with weekly, monthly, quarterly, and yearly reporting."
        action={<Button onClick={() => { setForm({ ...BLANK, occurred_at: ymd(new Date()) }); setErr(""); setOpen(true); }}>+ Add revenue event</Button>} />

      <Tabs tabs={GRAN_TABS} value={gran} onChange={(v) => setGran(v as Gran)} />

      {/* Current-period metrics */}
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatTile tone="dark" label={`This ${periodWord}`} value={money(cur.cents)} sub={prevCents ? <Delta current={cur.cents} prior={prevCents} fmt={money} /> : <span className="text-chrome-400">vs last {periodWord}</span>} />
        <StatTile label="Jobs" value={cur.n} sub={`paid this ${periodWord}`} />
        <StatTile label="Avg ticket" value={money(avg)} />
        <StatTile label="Highest sale" value={money(high)} tone="brand" />
        <StatTile label="Lowest sale" value={money(low)} />
      </div>

      {/* Trend chart */}
      <div className="mb-6 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-steel-200">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="eyebrow text-[10px] text-chrome-400">{gran === "yearly" ? "Year-over-year" : `${periodWord}ly trend`} · paid revenue</h2>
          {pending > 0 && <span className="text-xs text-amber-600">{money(pending)} pending</span>}
        </div>
        <LineChart points={chart} fmt={(n) => money(Math.round(n * 100))} />
      </div>

      {/* Event ledger */}
      {loading ? (
        <p className="text-sm text-chrome-400">Loading…</p>
      ) : items.length === 0 ? (
        <EmptyState title="No revenue events yet" hint="Log your first sale to start tracking monthly and yearly revenue."
          action={<Button onClick={() => setOpen(true)}>+ Add revenue event</Button>} />
      ) : (
        <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-steel-200">
          <table className="w-full text-sm">
            <thead className="bg-steel-50 text-left text-xs uppercase tracking-wide text-chrome-400">
              <tr>
                <th className="px-4 py-3 font-medium">Date</th>
                <th className="px-4 py-3 font-medium">Event</th>
                <th className="hidden px-4 py-3 font-medium sm:table-cell">Customer</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 text-right font-medium">Amount</th>
                <th />
              </tr>
            </thead>
            <tbody className="divide-y divide-steel-100">
              {items.map((e) => (
                <tr key={e.id} className="hover:bg-steel-50">
                  <td className="px-4 py-3 whitespace-nowrap text-neutral-600">{fmtDate(when(e))}</td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-graphite-950">{e.label}</div>
                    {(e.service || e.note) && <div className="truncate text-xs text-chrome-400">{[e.service, e.note].filter(Boolean).join(" · ")}</div>}
                  </td>
                  <td className="hidden px-4 py-3 text-neutral-600 sm:table-cell">{e.customer || "—"}</td>
                  <td className="px-4 py-3"><Tag color={colorOf(REVENUE_STATUS, e.status)}>{labelOf(REVENUE_STATUS, e.status)}</Tag></td>
                  <td className={`px-4 py-3 text-right font-semibold ${e.status === "paid" ? "text-graphite-950" : "text-chrome-400"}`}>{money(e.amount_cents)}</td>
                  <td className="px-4 py-3 text-right"><DeleteButton onClick={() => remove(e.id)} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="Add revenue event"
        footer={<><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button onClick={save} disabled={busy}>{busy ? "Saving…" : "Add event"}</Button></>}>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Amount ($)"><Input type="number" min="0" step="0.01" value={form.amount} autoFocus onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="0.00" /></Field>
            <Field label="Date"><Input type="date" value={form.occurred_at} onChange={(e) => setForm({ ...form, occurred_at: e.target.value })} /></Field>
          </div>
          <Field label="Label"><Input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="e.g. Full detail — Porsche 911" /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Customer"><Input value={form.customer} onChange={(e) => setForm({ ...form, customer: e.target.value })} placeholder="Name" /></Field>
            <Field label="Status"><Select options={REVENUE_STATUS} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} /></Field>
          </div>
          <Field label="Service / product">
            <Input value={form.service} onChange={(e) => setForm({ ...form, service: e.target.value })} placeholder="e.g. Full Detail" list="rev-products" />
            <datalist id="rev-products">{products.map((p) => <option key={p.id} value={p.name} />)}</datalist>
          </Field>
          <Field label="Notes (optional)"><Input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="Context…" /></Field>
          {err && <p className="text-sm text-rose-600">{err}</p>}
        </div>
      </Modal>
    </div>
  );
}
