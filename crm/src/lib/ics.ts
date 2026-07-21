export interface IcsJob {
  id: string;
  title: string;
  status: string;
  scheduled_start: string | null;
  scheduled_end: string | null;
  address: string | null;
  price_cents: number;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
}

function icsDate(iso: string): string {
  // ISO-8601 UTC -> 20260801T140000Z
  return new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function esc(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** Fold lines to 75 octets per RFC 5545 (simple char-based fold, adequate for ASCII). */
function fold(line: string): string {
  if (line.length <= 75) return line;
  const parts: string[] = [];
  let i = 0;
  while (i < line.length) {
    parts.push((i === 0 ? "" : " ") + line.slice(i, i + (i === 0 ? 75 : 74)));
    i += i === 0 ? 75 : 74;
  }
  return parts.join("\r\n");
}

export function buildIcs(jobs: IcsJob[]): string {
  const now = icsDate(new Date().toISOString());
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//BH Car Detailing//CRM//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:BH CRM Jobs",
  ];
  for (const j of jobs) {
    if (!j.scheduled_start) continue;
    const start = icsDate(j.scheduled_start);
    const end = icsDate(j.scheduled_end ?? new Date(new Date(j.scheduled_start).getTime() + 2 * 3600_000).toISOString());
    const name = [j.first_name, j.last_name].filter(Boolean).join(" ");
    const descParts = [
      `Status: ${j.status}`,
      j.price_cents ? `Price: $${(j.price_cents / 100).toFixed(2)}` : "",
      j.phone ? `Phone: ${j.phone}` : "",
    ].filter(Boolean);
    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${j.id}@bhcardetails.com`);
    lines.push(`DTSTAMP:${now}`);
    lines.push(`DTSTART:${start}`);
    lines.push(`DTEND:${end}`);
    lines.push(fold(`SUMMARY:${esc(name ? `${j.title} — ${name}` : j.title)}`));
    if (j.address) lines.push(fold(`LOCATION:${esc(j.address)}`));
    lines.push(fold(`DESCRIPTION:${esc(descParts.join("\n"))}`));
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}
