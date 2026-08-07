import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { Button, Modal, PageHeader, Skeleton, StatTile, Tag, Textarea } from "../components/ui";
import { useToast } from "../components/Toast";
import { fmtDate } from "../lib/datetime";

/**
 * The dead book, one day at a time.
 *
 * A capped daily queue rather than a list of 164 — the cap protects the number
 * from carrier filtering and keeps this a five-minute habit instead of a chore.
 */

interface QueueRow {
  contact_id: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  email: string | null;
  source: string | null;
  stage: string;
  created_at: string;
  vehicle: string | null;
  quoted_cents: number | null;
  score: number;
  reasons: string[];
  draft: string;
  can_send: boolean;
  blocked_reason: string | null;
  blocked_detail: string | null;
}

interface QueueResponse {
  items: QueueRow[];
  sent_today: number;
  remaining_today: number;
  daily_cap: number;
}

const nameOf = (r: QueueRow) =>
  [r.first_name, r.last_name].filter(Boolean).join(" ") || r.phone || "Unnamed contact";

export default function Reactivation() {
  const [data, setData] = useState<QueueResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [composing, setComposing] = useState<QueueRow | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const toast = useToast();

  const load = useCallback(async () => {
    try { setData(await api<QueueResponse>("/api/growth/reactivation/queue")); }
    catch { setData(null); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function skip(row: QueueRow) {
    setData((d) => d && { ...d, items: d.items.filter((i) => i.contact_id !== row.contact_id) });
    try {
      await api(`/api/growth/reactivation/${row.contact_id}/skip`, { method: "POST" });
      toast({ message: `${nameOf(row)} skipped.`, tone: "success" });
    } catch {
      toast({ message: "Could not skip — please retry.", tone: "error" });
      void load();
    }
  }

  async function send() {
    if (!composing) return;
    setSending(true);
    try {
      const res = await api<{ status?: string }>(`/api/growth/reactivation/${composing.contact_id}/send`, {
        method: "POST", body: JSON.stringify({ body: draft }),
      });
      toast({
        message: res.status === "logged"
          ? "Saved to the thread — texting goes live once Twilio is connected."
          : `Message sent to ${nameOf(composing)}.`,
        tone: "success",
      });
      setComposing(null);
      void load();
    } catch {
      toast({ message: "Send failed.", tone: "error" });
    } finally { setSending(false); }
  }

  return (
    <div className="mx-auto max-w-4xl p-4 md:p-8">
      <PageHeader
        eyebrow="Work the dead book"
        title="Reactivation"
        subtitle="Leads who enquired and were never booked. Best prospects first — approve each message before it sends."
      />

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatTile label="Sent today" value={loading ? <Skeleton className="h-6 w-10" /> : data?.sent_today ?? 0} />
        <StatTile label="Left today" value={loading ? <Skeleton className="h-6 w-10" /> : data?.remaining_today ?? 0}
          sub={`daily cap ${data?.daily_cap ?? 15}`} />
        <StatTile label="In queue" value={loading ? <Skeleton className="h-6 w-10" /> : data?.items.length ?? 0} />
      </div>

      {/* These contacts never gave SMS consent — say so where it matters. */}
      <div className="mb-5 rounded-xl bg-amber-50 px-4 py-3 text-xs text-amber-900 ring-1 ring-inset ring-amber-100">
        <strong>These contacts never opted in to texts.</strong> Each draft is written as a follow-up to their own
        enquiry, names the business, and offers opt-out — keep it that way. Promotions are only appropriate after
        someone replies and opts in.
      </div>

      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-20 w-full" /><Skeleton className="h-20 w-full" /><Skeleton className="h-20 w-full" />
        </div>
      ) : !data?.items.length ? (
        <div className="rounded-2xl border border-dashed border-neutral-200 bg-neutral-50/50 px-6 py-14 text-center">
          <p className="text-sm font-medium text-neutral-700">
            {data && data.remaining_today === 0 ? "That's the daily limit — nice work." : "Nobody left in the queue."}
          </p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-neutral-400">
            {data && data.remaining_today === 0
              ? "Come back tomorrow. Sending more than 15 a day to contacts who never opted in risks the number."
              : "Every un-worked lead has been contacted or skipped."}
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {data.items.map((r) => (
            <li key={r.contact_id} className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-neutral-100">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link to={`/contacts/${r.contact_id}`} className="text-sm font-semibold text-neutral-900 hover:text-red-600">
                      {nameOf(r)}
                    </Link>
                    {r.quoted_cents && <Tag color="brand">quoted ${Math.round(r.quoted_cents / 100)}</Tag>}
                    {r.vehicle && <span className="text-xs text-chrome-400">{r.vehicle}</span>}
                  </div>
                  <div className="mt-1 text-xs text-chrome-400">
                    {r.reasons.join(" · ") || "no signal on file"} · added {fmtDate(r.created_at)}
                  </div>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  <Button variant={r.can_send ? "primary" : "ghost"} disabled={!r.can_send}
                    onClick={() => { setComposing(r); setDraft(r.draft); }}>
                    Text them
                  </Button>
                  <Button variant="ghost" onClick={() => skip(r)}>Skip</Button>
                </div>
              </div>
              {!r.can_send && r.blocked_detail && (
                <div className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 ring-1 ring-inset ring-amber-100">
                  {r.blocked_detail}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <Modal
        open={!!composing}
        onClose={() => setComposing(null)}
        title={composing ? `Text ${nameOf(composing)}` : ""}
        footer={
          <>
            <Button variant="ghost" onClick={() => setComposing(null)}>Cancel</Button>
            <Button onClick={send} disabled={sending || !draft.trim()}>{sending ? "Sending…" : "Send text"}</Button>
          </>
        }
      >
        <p className="mb-2 text-xs text-chrome-400">
          Edit before sending.{composing?.phone ? ` Going to ${composing.phone}.` : ""}
        </p>
        <Textarea value={draft} onChange={(e) => setDraft(e.target.value)} />
        <p className="mt-2 text-xs text-chrome-400">
          {draft.length} characters · keep the opt-out line in
        </p>
      </Modal>
    </div>
  );
}
