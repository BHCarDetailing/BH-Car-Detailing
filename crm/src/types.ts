export interface Env {
  DB: D1Database;
  ASSETS?: Fetcher;
  ADMIN_PASSWORD: string;
  SESSION_SECRET: string;
  AGENT_API_KEY: string;
  ALLOWED_ORIGINS: string;
  HOME_TZ: string;
}

export const STAGES = ["new", "contacted", "quoted", "scheduled", "customer", "lost"] as const;
export type Stage = (typeof STAGES)[number];
