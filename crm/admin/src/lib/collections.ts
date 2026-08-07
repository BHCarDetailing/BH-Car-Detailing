import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import type { ToastFn } from "../components/Toast";

/**
 * useCollection — the single client-side data layer for every operating-system
 * page (clients, updates, revenue, team, tasks, …). Wraps the generic
 * /api/c/:name CRUD endpoints so each page is a thin config over this hook.
 */
export interface Row {
  id: string;
  [k: string]: unknown;
}

export function useCollection<T extends Row = Row>(name: string) {
  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api<{ items: T[] }>(`/api/c/${name}`);
      setItems(r.items);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "load_failed");
    } finally {
      setLoading(false);
    }
  }, [name]);

  useEffect(() => { reload(); }, [reload]);

  const create = useCallback(async (data: Record<string, unknown>) => {
    const r = await api<{ item: T }>(`/api/c/${name}`, { method: "POST", body: JSON.stringify(data) });
    setItems((prev) => [r.item, ...prev]);
    return r.item;
  }, [name]);

  const update = useCallback(async (id: string, data: Record<string, unknown>) => {
    const r = await api<{ item: T }>(`/api/c/${name}/${id}`, { method: "PATCH", body: JSON.stringify(data) });
    setItems((prev) => prev.map((it) => (it.id === id ? r.item : it)));
    return r.item;
  }, [name]);

  const remove = useCallback(async (id: string) => {
    await api(`/api/c/${name}/${id}`, { method: "DELETE" });
    setItems((prev) => prev.filter((it) => it.id !== id));
  }, [name]);

  /**
   * Delete with a grace window. The row leaves the UI immediately and the
   * server DELETE is deferred; an "Undo" toast can cancel it and restore the
   * row at its original position. Gives real recovery without a soft-delete
   * column. Pass the `toast` fn from useToast().
   */
  const removeWithUndo = useCallback((id: string, toast: ToastFn, opts?: { label?: string; grace?: number }) => {
    let snapshot: { row: T; index: number } | null = null;
    setItems((prev) => {
      const index = prev.findIndex((it) => it.id === id);
      if (index < 0) return prev;
      snapshot = { row: prev[index], index };
      return prev.filter((it) => it.id !== id);
    });
    const grace = opts?.grace ?? 5000;
    let undone = false;
    const timer = setTimeout(() => {
      if (undone) return;
      api(`/api/c/${name}/${id}`, { method: "DELETE" }).catch(() => reload());
    }, grace);
    toast({
      message: opts?.label ?? "Deleted.",
      actionLabel: "Undo",
      duration: grace,
      onAction: () => {
        undone = true;
        clearTimeout(timer);
        setItems((prev) => {
          if (!snapshot || prev.some((it) => it.id === snapshot!.row.id)) return prev;
          const next = prev.slice();
          next.splice(Math.min(snapshot.index, next.length), 0, snapshot.row);
          return next;
        });
      },
    });
  }, [name, reload]);

  return { items, loading, error, reload, create, update, remove, removeWithUndo };
}

/** Shared option maps + labels (mirror the enum whitelists in the worker). */
export const UPDATE_CATS = [
  { value: "general", label: "General", color: "neutral" },
  { value: "meeting", label: "Meeting", color: "blue" },
  { value: "car_event", label: "Car event", color: "brand" },
  { value: "call", label: "Call", color: "green" },
  { value: "follow_up", label: "Follow-up", color: "amber" },
  { value: "win", label: "Win", color: "violet" },
  { value: "sequence", label: "Sequence", color: "blue" },
] as const;

export const CLIENT_TYPES = [
  { value: "residential", label: "Residential" },
  { value: "fleet", label: "Fleet" },
  { value: "dealership", label: "Dealership" },
  { value: "exotic", label: "Exotic / Luxury" },
  { value: "commercial", label: "Commercial" },
] as const;

export const CLIENT_STAGES = [
  { value: "lead", label: "Lead", color: "neutral" },
  { value: "active", label: "Active", color: "green" },
  { value: "recurring", label: "Recurring", color: "brand" },
  { value: "paused", label: "Paused", color: "amber" },
  { value: "churned", label: "Churned", color: "red" },
] as const;

export const REVENUE_STATUS = [
  { value: "paid", label: "Paid", color: "green" },
  { value: "pending", label: "Pending", color: "amber" },
  { value: "refunded", label: "Refunded", color: "violet" },
  { value: "cancelled", label: "Cancelled", color: "red" },
] as const;

export const EXPENSE_CATEGORY = [
  { value: "supplies", label: "Supplies", color: "blue" },
  { value: "equipment", label: "Equipment", color: "violet" },
  { value: "fuel", label: "Fuel", color: "amber" },
  { value: "marketing", label: "Marketing", color: "green" },
  { value: "software", label: "Software", color: "neutral" },
  { value: "insurance", label: "Insurance", color: "red" },
  { value: "fees", label: "Fees", color: "neutral" },
  { value: "other", label: "Other", color: "neutral" },
] as const;

export const PROSPECT_STATUS = [
  { value: "new", label: "New", color: "neutral" },
  { value: "contacted", label: "Contacted", color: "blue" },
  { value: "follow_up", label: "Follow-up", color: "amber" },
  { value: "won", label: "Won", color: "green" },
  { value: "lost", label: "Lost", color: "red" },
] as const;

export const CAMPAIGN_CHANNELS = [
  { value: "google_ads", label: "Google Ads", color: "blue" },
  { value: "google_lsa", label: "Google LSA", color: "green" },
  { value: "instagram", label: "Instagram", color: "violet" },
  { value: "facebook", label: "Facebook", color: "blue" },
  { value: "other", label: "Other", color: "neutral" },
] as const;

export const CAMPAIGN_STATUS = [
  { value: "active", label: "Active", color: "green" },
  { value: "paused", label: "Paused", color: "amber" },
  { value: "ended", label: "Ended", color: "neutral" },
] as const;

export const CONTENT_CHANNELS = [
  { value: "instagram", label: "Instagram", color: "violet" },
  { value: "facebook", label: "Facebook", color: "blue" },
  { value: "tiktok", label: "TikTok", color: "neutral" },
  { value: "youtube", label: "YouTube", color: "red" },
  { value: "blog", label: "Blog", color: "amber" },
  { value: "other", label: "Other", color: "neutral" },
] as const;

export const CONTENT_STATUS = [
  { value: "draft", label: "Draft", color: "neutral" },
  { value: "scheduled", label: "Scheduled", color: "blue" },
  { value: "published", label: "Published", color: "green" },
] as const;

export const ACCT_BUCKETS = [
  { value: "today", label: "Today" },
  { value: "week", label: "This week" },
  { value: "month", label: "This month" },
  { value: "wins", label: "Wins" },
] as const;

export const ACCT_STATUS = [
  { value: "not_started", label: "Not started", color: "neutral" },
  { value: "started", label: "Started", color: "blue" },
  { value: "needs_attention", label: "Needs attention", color: "amber" },
  { value: "done", label: "Done", color: "green" },
  { value: "flagged", label: "Flagged", color: "red" },
] as const;

export const ONBOARD_STATUS = [
  { value: "todo", label: "To do", color: "neutral" },
  { value: "in_progress", label: "In progress", color: "blue" },
  { value: "done", label: "Done", color: "green" },
] as const;

export const CADENCES = [
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "none", label: "None" },
] as const;

export function labelOf(list: readonly { value: string; label: string }[], v: unknown): string {
  return list.find((o) => o.value === v)?.label ?? String(v ?? "");
}

export function colorOf(list: readonly { value: string; label: string; color?: string }[], v: unknown): string {
  return list.find((o) => o.value === v)?.color ?? "neutral";
}
