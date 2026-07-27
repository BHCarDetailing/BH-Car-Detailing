const TZ = "America/New_York";

export function startOfWeek(d = new Date()): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - x.getDay()); // Sunday start
  return x;
}

export function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

export function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function dayLabel(d: Date): string {
  return new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric" }).format(d);
}

export function timeLabel(iso: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" }).format(new Date(iso));
}

/** True if the job's scheduled_start falls on calendar day `d` (local). */
export function isOnDay(iso: string | null, d: Date): boolean {
  if (!iso) return false;
  const j = new Date(iso);
  return j.getFullYear() === d.getFullYear() && j.getMonth() === d.getMonth() && j.getDate() === d.getDate();
}

/* ---- Universal timestamp helpers (used app-wide via <Timestamp/>) ---- */

/** "Jul 27, 2026" */
export function fmtDate(iso: string | number | Date): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(iso));
}

/** "10:42 AM" */
export function fmtTime(iso: string | number | Date): string {
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(new Date(iso));
}

/** "Jul 27, 2026 · 10:42 AM" */
export function fmtDateTime(iso: string | number | Date): string {
  return `${fmtDate(iso)} · ${fmtTime(iso)}`;
}

/** "just now" / "3h ago" / "5d ago" / falls back to date for older */
export function relTime(iso: string | number | Date): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const diff = Date.now() - then;
  const min = Math.round(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 7) return `${day}d ago`;
  if (day < 30) return `${Math.round(day / 7)}w ago`;
  return fmtDate(iso);
}
