export interface Env {
  DB: D1Database;
  MEDIA?: R2Bucket;
  ASSETS?: Fetcher;
  ADMIN_PASSWORD: string;
  SESSION_SECRET: string;
  AGENT_API_KEY: string;
  ALLOWED_ORIGINS: string;
  HOME_TZ: string;
  RESEND_API_KEY?: string;
  FROM_EMAIL?: string;
  FROM_NAME?: string;
  REPLY_TO?: string;
  BUSINESS_ADDRESS?: string;
  TWILIO_ACCOUNT_SID?: string;
  TWILIO_AUTH_TOKEN?: string;
  TWILIO_FROM_NUMBER?: string;
  TWILIO_MESSAGING_SERVICE_SID?: string;
  PUBLIC_BASE_URL?: string;
  ANTHROPIC_API_KEY?: string;
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
}

export const STAGES = ["new", "contacted", "quoted", "scheduled", "customer", "lost"] as const;
export type Stage = (typeof STAGES)[number];
