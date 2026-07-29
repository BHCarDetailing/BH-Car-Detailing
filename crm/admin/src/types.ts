export const STAGES = ["new", "contacted", "quoted", "scheduled", "customer", "lost"] as const;
export type Stage = (typeof STAGES)[number];

export interface Vehicle {
  id: string;
  size_class: string;
  notes: string | null;
  year: number | null;
  make: string | null;
  model: string | null;
}

export interface Contact {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  area_slug: string | null;
  stage: Stage;
  source: string | null;
  source_detail: string | null;
  created_at: string;
  last_activity_at: string | null;
  deleted_at?: string | null;
  vehicle_count?: number;
  vehicles?: Vehicle[];
  tags?: string[];
  custom?: Record<string, unknown>;
  ai_summary?: string | null;
  ai_next_action?: string | null;
  revenue?: ContactRevenue[];
  related?: { jobs: number; paid_revenue_cents: number };
}

export interface ContactRevenue {
  id: string;
  label: string;
  amount_cents: number;
  occurred_at: string | null;
  status: string;
  service: string | null;
  created_at: string;
}

export interface EmailMessage {
  id: string;
  subject: string | null;
  body_text: string | null;
  body_html: string | null;
  status: string;
  kind: string;
  created_at: string;
  sent_at: string | null;
  to_email: string | null;
  first_name?: string | null;
  last_name?: string | null;
}

export interface Label {
  key: string;
  label: string;
  color: string;
  sort: number;
}

export interface Activity {
  id: number;
  type: string;
  title: string;
  payload: string | null;
  actor: string;
  created_at: string;
}

export interface Job {
  id: string;
  contact_id: string;
  title: string;
  status: string;
  price_cents: number;
  scheduled_start: string | null;
  scheduled_end: string | null;
  address: string | null;
  first_name?: string | null;
  last_name?: string | null;
  phone?: string | null;
  quote_token?: string | null;
  quote_sent_at?: string | null;
  quote_accepted_at?: string | null;
  amount_paid_cents?: number;
  paid_in_full?: number;
}

export const SIZE_CLASSES = ["sedan", "suv", "truck", "van", "exotic", "other"] as const;
export type SizeClass = (typeof SIZE_CLASSES)[number];

export interface Service {
  id: string;
  name: string;
  description: string | null;
  size_pricing: Partial<Record<SizeClass, number>>;
  base_price_cents: number;
  active: boolean;
  sort: number;
  /** interior | exterior | both | specialty */
  area?: string | null;
  /** maintenance | light | full | specialty */
  level?: string | null;
  duration_min?: number | null;
  /** Offered in the add-on strip alongside a main service. */
  is_addon?: boolean;
  /** Sellable on its own. A row can be both this and an add-on. */
  standalone?: boolean;
  /** Quoted after seeing the car; never booked on the spot. */
  requires_planning?: boolean;
}

export interface QuoteItem {
  service_id?: string;
  name: string;
  price_cents: number;
  qty: number;
}

export interface SmsMessage {
  id: string;
  contact_id: string;
  body_text: string | null;
  direction: string; // 'outbound' | 'inbound'
  status: string;
  created_at: string;
  channel?: string; // 'sms' | 'webchat'
}

export interface Revenue {
  month_cents: number;
  week_cents: number;
  pipeline_cents: number;
  pipeline_jobs: number;
  all_time_cents: number;
  jobs_paid_all: number;
  avg_ticket_cents: number;
  series: Array<{ ym: string; cents: number; n: number }>;
}

export interface Stats {
  byStage: Record<Stage, number>;
  recent: Array<{ id: number; type: string; title: string; created_at: string; contact_id: string; first_name: string | null; last_name: string | null }>;
  todayJobs: Array<{ id: string; title: string; status: string; scheduled_start: string | null; contact_id: string; first_name: string | null; last_name: string | null; phone: string | null }>;
  openTasks: Array<{ id: string; title: string; due_at: string | null; contact_id: string | null; first_name: string | null; last_name: string | null }>;
  revenue?: Revenue;
}

/**
 * Whole dollars when the amount is round, cents when it is not — a tax line of
 * $19.95 must never be shown to a customer as $20.
 */
export function money(cents: number): string {
  const v = (cents || 0) / 100;
  const fraction = Math.abs(cents || 0) % 100 === 0 ? 0 : 2;
  return new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD",
    minimumFractionDigits: fraction, maximumFractionDigits: fraction,
  }).format(v);
}

export function fullName(c: Pick<Contact, "first_name" | "last_name">): string {
  return [c.first_name, c.last_name].filter(Boolean).join(" ") || "(no name)";
}
