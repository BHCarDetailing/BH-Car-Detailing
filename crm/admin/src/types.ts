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
  vehicle_count?: number;
  vehicles?: Vehicle[];
  tags?: string[];
  custom?: Record<string, unknown>;
  ai_summary?: string | null;
  ai_next_action?: string | null;
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
}

export interface SmsMessage {
  id: string;
  contact_id: string;
  body_text: string | null;
  direction: string; // 'outbound' | 'inbound'
  status: string;
  created_at: string;
}

export interface Stats {
  byStage: Record<Stage, number>;
  recent: Array<{ id: number; type: string; title: string; created_at: string; contact_id: string; first_name: string | null; last_name: string | null }>;
  todayJobs: Array<{ id: string; title: string; status: string; scheduled_start: string | null; contact_id: string; first_name: string | null; last_name: string | null; phone: string | null }>;
  openTasks: Array<{ id: string; title: string; due_at: string | null; contact_id: string | null; first_name: string | null; last_name: string | null }>;
}

export function fullName(c: Pick<Contact, "first_name" | "last_name">): string {
  return [c.first_name, c.last_name].filter(Boolean).join(" ") || "(no name)";
}
