import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { money, type QuoteItem } from "../types";

interface QuoteData {
  business: string;
  title: string;
  customer_first: string | null;
  status: string;
  accepted: boolean;
  items: QuoteItem[];
  total_cents: number;
  tax_cents: number;
  tax_label: string | null;
  subtotal_cents: number;
  notes: string | null;
  created_at: string;
  payments_enabled: boolean;
  deposit_cents: number;
  deposit_percent: number;
  allow_full: boolean;
  amount_paid_cents: number;
  paid: boolean;
  paid_in_full: boolean;
}

export default function Quote() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<QuoteData | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "notfound">("loading");
  const [accepting, setAccepting] = useState(false);

  useEffect(() => {
    fetch(`/api/quote/${token}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: QuoteData) => { setData(d); setState("ok"); })
      .catch(() => setState("notfound"));
  }, [token]);

  async function accept() {
    setAccepting(true);
    try {
      await fetch(`/api/quote/${token}/accept`, { method: "POST" });
      setData((d) => (d ? { ...d, accepted: true } : d));
    } finally { setAccepting(false); }
  }

  const [paying, setPaying] = useState("");
  async function pay(kind: "deposit" | "full") {
    setPaying(kind);
    try {
      const res = await fetch(`/api/quote/${token}/checkout`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind }),
      });
      const j = (await res.json()) as { url?: string };
      if (j.url) location.href = j.url;
      else setPaying("");
    } catch { setPaying(""); }
  }
  const justPaid = new URLSearchParams(location.search).get("paid") === "1";

  if (state === "loading") return <div className="p-8 text-center text-neutral-500">Loading…</div>;
  if (state === "notfound" || !data) return (
    <div className="mx-auto max-w-md p-8 text-center">
      <h1 className="text-xl font-semibold text-neutral-900">Quote not found</h1>
      <p className="mt-2 text-neutral-500">This quote link is invalid or has expired. Text us and we'll send a fresh one.</p>
    </div>
  );

  return (
    <div className="min-h-screen bg-neutral-100 py-8">
      <div className="mx-auto max-w-md px-4">
        <div className="mb-4 flex items-center gap-3">
          <img src="/brand/logo.png" alt={data.business} className="h-12 w-auto" />
          <div>
            <div className="font-semibold text-neutral-900">{data.business}</div>
            <div className="text-xs text-neutral-500">Quote · {new Date(data.created_at).toLocaleDateString()}</div>
          </div>
        </div>

        <div className="rounded-2xl bg-white p-6 shadow-sm">
          <h1 className="text-lg font-semibold text-neutral-900">{data.customer_first ? `Hi ${data.customer_first}, here's your quote` : "Your quote"}</h1>

          <ul className="mt-4 divide-y">
            {data.items.length === 0 ? (
              <li className="py-3 text-sm text-neutral-500">{data.title}</li>
            ) : data.items.map((it, i) => (
              <li key={i} className="flex items-center justify-between gap-3 py-3">
                <span className="text-sm text-neutral-800">{it.name}{it.qty > 1 ? ` ×${it.qty}` : ""}</span>
                <span className={`text-sm font-medium ${it.price_cents < 0 ? "text-green-600" : "text-neutral-900"}`}>{money(it.price_cents * it.qty)}</span>
              </li>
            ))}
          </ul>

          {data.tax_cents > 0 && (
            <div className="mt-4 space-y-1.5 border-t pt-4">
              <div className="flex items-center justify-between text-sm">
                <span className="text-neutral-500">Subtotal</span>
                <span className="text-neutral-600">{money(data.subtotal_cents)}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-neutral-500">{data.tax_label ?? "Sales tax"}</span>
                <span className="text-neutral-600">{money(data.tax_cents)}</span>
              </div>
            </div>
          )}

          <div className={`mt-4 flex items-center justify-between pt-4 ${data.tax_cents > 0 ? "" : "border-t"}`}>
            <span className="font-medium text-neutral-600">Total</span>
            <span className="text-2xl font-bold text-neutral-900">{money(data.total_cents)}</span>
          </div>

          {data.notes && <p className="mt-4 rounded-lg bg-neutral-50 p-3 text-sm text-neutral-600">{data.notes}</p>}

          {(justPaid || data.paid) && (
            <div className="mt-4 rounded-lg bg-green-50 p-3 text-center text-sm text-green-700">
              {data.paid_in_full ? "✓ Paid in full — thank you!" : `✓ ${money(data.amount_paid_cents)} paid. Balance due: ${money(Math.max(0, data.total_cents - data.amount_paid_cents))}.`}
            </div>
          )}

          {!data.paid_in_full && (
            <div className="mt-6 space-y-2">
              {!data.accepted && (
                <button onClick={accept} disabled={accepting} className="min-h-[52px] w-full rounded-md bg-neutral-900 px-4 text-base font-medium text-white disabled:opacity-50">
                  {accepting ? "Accepting…" : "Accept this quote"}
                </button>
              )}
              {data.payments_enabled && data.deposit_cents > 0 && !data.paid && (
                <button onClick={() => pay("deposit")} disabled={!!paying} className="min-h-[52px] w-full rounded-md bg-red-600 px-4 text-base font-medium text-white disabled:opacity-50">
                  {paying === "deposit" ? "Redirecting…" : `Pay ${data.deposit_percent}% deposit — ${money(data.deposit_cents)}`}
                </button>
              )}
              {data.payments_enabled && data.allow_full && (
                <button onClick={() => pay("full")} disabled={!!paying} className={`min-h-[52px] w-full rounded-md px-4 text-base font-medium disabled:opacity-50 ${data.paid ? "bg-red-600 text-white" : "bg-neutral-200 text-neutral-900"}`}>
                  {paying === "full" ? "Redirecting…" : data.paid ? `Pay balance — ${money(Math.max(0, data.total_cents - data.amount_paid_cents))}` : `Pay in full — ${money(data.total_cents)}`}
                </button>
              )}
              {data.accepted && !data.payments_enabled && (
                <div className="rounded-lg bg-green-50 p-4 text-center">
                  <div className="text-lg font-semibold text-green-700">✓ Quote accepted</div>
                  <p className="mt-1 text-sm text-green-600">Thanks! We'll reach out to schedule your appointment.</p>
                </div>
              )}
            </div>
          )}
        </div>

        <p className="mt-4 text-center text-xs text-neutral-400">Questions? Just reply to the text we sent you.</p>
      </div>
    </div>
  );
}
