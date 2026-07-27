import { useCallback, useEffect, useState } from "react";
import { api } from "../api";

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

  return { items, loading, error, reload, create, update, remove };
}

/** Shared option maps + labels (mirror the enum whitelists in the worker). */
export const UPDATE_CATS = [
  { value: "general", label: "General", color: "neutral" },
  { value: "meeting", label: "Meeting", color: "blue" },
  { value: "car_event", label: "Car event", color: "brand" },
  { value: "call", label: "Call", color: "green" },
  { value: "follow_up", label: "Follow-up", color: "amber" },
  { value: "win", label: "Win", color: "violet" },
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

export const REVENUE_KINDS = [
  { value: "arr", label: "ARR" },
  { value: "mrr", label: "MRR" },
  { value: "pipeline", label: "Pipeline" },
  { value: "active", label: "Active" },
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
