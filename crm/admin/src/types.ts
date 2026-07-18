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
}

export interface Activity {
  id: number;
  type: string;
  title: string;
  payload: string | null;
  actor: string;
  created_at: string;
}

export interface Stats {
  byStage: Record<Stage, number>;
  recent: Array<{ id: number; type: string; title: string; created_at: string; contact_id: string; first_name: string | null; last_name: string | null }>;
}

export function fullName(c: Pick<Contact, "first_name" | "last_name">): string {
  return [c.first_name, c.last_name].filter(Boolean).join(" ") || "(no name)";
}
