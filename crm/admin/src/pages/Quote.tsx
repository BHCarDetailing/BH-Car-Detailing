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
  notes: string | null;
  created_at: string;
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

          <div className="mt-4 flex items-center justify-between border-t pt-4">
            <span className="font-medium text-neutral-600">Total</span>
            <span className="text-2xl font-bold text-neutral-900">{money(data.total_cents)}</span>
          </div>

          {data.notes && <p className="mt-4 rounded-lg bg-neutral-50 p-3 text-sm text-neutral-600">{data.notes}</p>}

          {data.accepted ? (
            <div className="mt-6 rounded-lg bg-green-50 p-4 text-center">
              <div className="text-lg font-semibold text-green-700">✓ Quote accepted</div>
              <p className="mt-1 text-sm text-green-600">Thanks! We'll reach out to schedule your appointment.</p>
            </div>
          ) : (
            <button onClick={accept} disabled={accepting} className="mt-6 min-h-[52px] w-full rounded-md bg-red-600 px-4 text-base font-medium text-white disabled:opacity-50">
              {accepting ? "Accepting…" : "Accept this quote"}
            </button>
          )}
        </div>

        <p className="mt-4 text-center text-xs text-neutral-400">Questions? Just reply to the text we sent you.</p>
      </div>
    </div>
  );
}
