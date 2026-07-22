import type { Env } from "../types";
import { all, one } from "./db";

export interface BusinessHours {
  days: number[];      // 0=Sun..6=Sat
  start: string;       // "HH:MM" local
  end: string;         // "HH:MM" local
  slot_min: number;    // slot length + assumed job duration
  buffer_min: number;  // travel buffer around jobs
}

const DEFAULTS: BusinessHours = { days: [1, 2, 3, 4, 5, 6], start: "09:00", end: "18:00", slot_min: 120, buffer_min: 30 };

export async function businessHours(env: Env): Promise<BusinessHours> {
  const row = await one<{ value: string }>(env.DB, "SELECT value FROM settings WHERE key = 'business_hours'");
  if (!row?.value) return DEFAULTS;
  try {
    const p = JSON.parse(row.value) as Partial<BusinessHours>;
    return {
      days: Array.isArray(p.days) && p.days.length ? p.days.map(Number) : DEFAULTS.days,
      start: typeof p.start === "string" ? p.start : DEFAULTS.start,
      end: typeof p.end === "string" ? p.end : DEFAULTS.end,
      slot_min: Number(p.slot_min) > 0 ? Number(p.slot_min) : DEFAULTS.slot_min,
      buffer_min: Number.isFinite(Number(p.buffer_min)) ? Number(p.buffer_min) : DEFAULTS.buffer_min,
    };
  } catch { return DEFAULTS; }
}

function tzOffsetHours(tz: string, atUtcMs: number): number {
  const s = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "shortOffset" })
    .formatToParts(new Date(atUtcMs)).find((p) => p.type === "timeZoneName")?.value ?? "GMT+0";
  const m = s.match(/GMT([+-]?\d{1,2})(?::?(\d{2}))?/);
  if (!m) return 0;
  const h = parseInt(m[1], 10);
  const min = m[2] ? parseInt(m[2], 10) : 0;
  return h + (h < 0 ? -min / 60 : min / 60);
}

/** UTC ISO instant for local wall-clock `HH:MM` on `dateStr` in `tz` (DST-aware). */
export function zonedToUtcIso(dateStr: string, hhmm: string, tz: string): string {
  const [hh, mm] = hhmm.split(":").map(Number);
  const guessMs = Date.parse(`${dateStr}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00Z`);
  const off = tzOffsetHours(tz, guessMs);
  return new Date(guessMs - off * 3600_000).toISOString();
}

interface JobWindow { scheduled_start: string; scheduled_end: string | null }

/** Open slot starts (UTC ISO) for `dateStr`: within hours, not past, no overlap (+buffer) with existing jobs. */
export async function availableSlots(env: Env, dateStr: string): Promise<string[]> {
  const cfg = await businessHours(env);
  const tz = env.HOME_TZ || "America/New_York";
  const dow = new Date(`${dateStr}T12:00:00Z`).getUTCDay();
  if (!cfg.days.includes(dow)) return [];

  const dayStart = Date.parse(zonedToUtcIso(dateStr, cfg.start, tz));
  const dayEnd = Date.parse(zonedToUtcIso(dateStr, cfg.end, tz));
  const jobs = await all<JobWindow>(
    env.DB,
    "SELECT scheduled_start, scheduled_end FROM jobs WHERE status IN ('scheduled','in_progress') AND scheduled_start >= ? AND scheduled_start <= ?",
    new Date(dayStart - 6 * 3600_000).toISOString(), new Date(dayEnd + 6 * 3600_000).toISOString()
  );
  const slotMs = cfg.slot_min * 60_000;
  const buffer = cfg.buffer_min * 60_000;
  const now = Date.now();
  const out: string[] = [];
  for (let t = dayStart; t + slotMs <= dayEnd + 1; t += slotMs) {
    if (t < now) continue;
    const s = t, e = t + slotMs;
    const clash = jobs.some((j) => {
      const js = Date.parse(j.scheduled_start);
      const je = j.scheduled_end ? Date.parse(j.scheduled_end) : js + slotMs;
      return s < je + buffer && js - buffer < e;
    });
    if (!clash) out.push(new Date(t).toISOString());
  }
  return out;
}

export const slotEndIso = (startIso: string, slotMin: number): string =>
  new Date(Date.parse(startIso) + slotMin * 60_000).toISOString();

/** Re-validate a chosen slot is still free (overlap + buffer against existing jobs). */
export async function slotIsFree(env: Env, startIso: string): Promise<boolean> {
  const cfg = await businessHours(env);
  const s = Date.parse(startIso);
  if (!Number.isFinite(s)) return false;
  const e = s + cfg.slot_min * 60_000;
  const buffer = cfg.buffer_min * 60_000;
  const jobs = await all<JobWindow>(
    env.DB,
    "SELECT scheduled_start, scheduled_end FROM jobs WHERE status IN ('scheduled','in_progress') AND scheduled_start >= ? AND scheduled_start <= ?",
    new Date(s - 24 * 3600_000).toISOString(), new Date(e + 24 * 3600_000).toISOString()
  );
  return !jobs.some((j) => {
    const js = Date.parse(j.scheduled_start);
    const je = j.scheduled_end ? Date.parse(j.scheduled_end) : js + cfg.slot_min * 60_000;
    return s < je + buffer && js - buffer < e;
  });
}
