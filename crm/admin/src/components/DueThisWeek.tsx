import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { Button, Modal, Skeleton, Tag, Textarea } from "./ui";
import { useToast } from "./Toast";
import { fmtDate } from "../lib/datetime";

/**
 * The rebook worklist: who is due back this week, best customers first.
 *
 * Nothing sends on its own. Each row carries a drafted message that Max can
 * edit before it goes anywhere, and a verdict explaining when a customer
 * can't be texted (opted out, already messaged, quiet hours).
 */

export interface DueRow {
  contact_id: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  next_due_at: string;
  last_service_at: string | null;
  job_count: number;
  lifetime_value_cents: number;
  last_job_title: string | null;
  last_job_price_cents: number | null;
  vehicle: string | null;
  size_class: string | null;
  bucket: "due_soon" | "due_now" | "overdue" | "lapsing";
  days_out: number;
  draft: string;
  can_send: boolean;
  blocked_reason: string | null;
  blocked_detail: string | null;
}

const BUCKETS: Record<DueRow["bucket"], { label: string; color: string }> = {
  due_soon: { label: "Due soon", color: "blue" },
  due_now: { label: "Due now", color: "brand" },
  overdue: { label: "Overdue", color: "amber" },
  lapsing: { label: "Lapsing", color: "red" },
};

const money = (cents?: number | null) => `$${Math.round((cents ?? 0) / 100).toLocaleString()}`;

const nameOf = (r: DueRow) =>
  [r.first_name, r.last_name].filter(Boolean).join(" ") || r.phone || "Unnamed contact";

function dueLabel(r: DueRow): string {
  if (r.days_out === 0) return "due today";
  if (r.days_out > 0) return `due in ${r.days_out} day${r.days_out === 1 ? "" : "s"}`;
  const late = Math.abs(r.days_out);
  return `${late} day${late === 1 ? "" : "s"} overdue`;
}

export default function DueThisWeek() {
  const [rows, setRows] = useState<DueRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [potential, setPotential] = useState(0);
  const [composing, setComposing] = useState<DueRow | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const toast = useToast();

  const load = useCallback(async () => {
    try {
      const r = await api<{ items: DueRow[]; potential_cents: number }>("/api/rebook/due?limit=25");
      setRows(r.items);
      setPotential(r.potential_cents);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function snooze(row: DueRow) {
    setRows((rs) => rs.filter((r) => r.contact_id !== row.contact_id));
    try {
      await api(`/api/rebook/${row.contact_id}/snooze`, { method: "POST", body: JSON.stringify({ days: 14 }) });
      toast({ message: `${nameOf(row)} snoozed for 2 weeks.`, tone: "success" });
    } catch {
      toast({ message: "Could not snooze — please retry.", tone: "error" });
      void load();
    }
  }

  async function send() {
    if (!composing) return;
    setSending(true);
    try {
      const res = await api<{ ok: boolean; detail?: string; status?: string }>(
        `/api/rebook/${composing.contact_id}/send`,
        { method: "POST", body: JSON.stringify({ body: draft }) }
      );
      toast({
        message: res.status === "logged"
          ? "Saved to the thread — texting goes live once Twilio is connected."
          : `Rebook offer sent to ${nameOf(composing)}.`,
        tone: "success",
      });
      setComposing(null);
      void load();
    } catch (e) {
      const detail = e instanceof Error ? e.message : "";
      toast({ message: detail.includes("opted_out") ? "That customer opted out of texts." : "Send failed.", tone: "error" });
    } finally {
      setSending(false);
    }
  }

  if (loading) {
    return (
      <div className="mb-6 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-neutral-100">
        <Skeleton className="h-5 w-40" />
        <div className="mt-4 space-y-2">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      </div>
    );
  }

  if (!rows.length) {
    return (
      <div className="mb-6 rounded-2xl border border-dashed border-neutral-200 bg-neutral-50/50 px-6 py-8 text-center">
        <p className="text-sm font-medium text-neutral-700">Nobody is due for a rebook this week.</p>
        <p className="mt-1 text-sm text-neutral-400">
          Due dates are set automatically when you mark a job complete.
        </p>
      </div>
    );
  }

  return (
    <div className="mb-6">
      <div className="mb-3 flex items-end justify-between gap-3">
        <div>
          <div className="mb-1.5 flex items-center gap-2">
            <span className="h-3 w-1 -skew-x-12 rounded-sm bg-red-600" />
            <span className="eyebrow text-[11px] text-red-600">Work this first</span>
          </div>
          <h2 className="font-display text-2xl leading-none text-graphite-950">
            Due this week ({rows.length})
          </h2>
        </div>
        {potential > 0 && (
          <div className="text-right">
            <div className="font-display text-xl leading-none text-graphite-950">{money(potential)}</div>
            <div className="text-xs text-chrome-400">of repeat work</div>
          </div>
        )}
      </div>

      <div className="space-y-2">
        {rows.map((r) => (
          <div key={r.contact_id} className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-neutral-100">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Link to={`/contacts/${r.contact_id}`} className="text-sm font-semibold text-neutral-900 hover:text-red-600">
                    {nameOf(r)}
                  </Link>
                  <Tag color={BUCKETS[r.bucket].color}>{BUCKETS[r.bucket].label}</Tag>
                  {r.vehicle && <span className="text-xs text-chrome-400">{r.vehicle}</span>}
                </div>
                <div className="mt-1 text-xs text-chrome-400">
                  {r.last_job_title ?? "No past job"}
                  {r.last_job_price_cents ? ` · ${money(r.last_job_price_cents)}` : ""}
                  {r.last_service_at ? ` · last ${fmtDate(r.last_service_at)}` : ""}
                  {` · ${dueLabel(r)}`}
                </div>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                <Button
                  variant={r.can_send ? "primary" : "ghost"}
                  disabled={!r.can_send}
                  onClick={() => { setComposing(r); setDraft(r.draft); }}
                >
                  Text offer
                </Button>
                <Button variant="ghost" onClick={() => snooze(r)}>Snooze 2w</Button>
              </div>
            </div>
            {!r.can_send && r.blocked_detail && (
              <div className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 ring-1 ring-inset ring-amber-100">
                {r.blocked_detail}
              </div>
            )}
          </div>
        ))}
      </div>

      <Modal
        open={!!composing}
        onClose={() => setComposing(null)}
        title={composing ? `Text ${nameOf(composing)}` : ""}
        footer={
          <>
            <Button variant="ghost" onClick={() => setComposing(null)}>Cancel</Button>
            <Button onClick={send} disabled={sending || !draft.trim()}>
              {sending ? "Sending…" : "Send text"}
            </Button>
          </>
        }
      >
        <p className="mb-2 text-xs text-chrome-400">
          Edit before sending. {composing?.phone ? `Going to ${composing.phone}.` : ""}
        </p>
        <Textarea value={draft} onChange={(e) => setDraft(e.target.value)} />
        <p className="mt-2 text-xs text-chrome-400">{draft.length} characters</p>
      </Modal>
    </div>
  );
}
