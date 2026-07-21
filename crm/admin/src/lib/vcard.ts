export interface ParsedContact {
  first_name?: string;
  last_name?: string;
  email?: string;
  phone?: string;
  address?: string;
  source: string;
}

/** Unfold RFC-6350 folded lines: a line beginning with space/tab continues the previous. */
function unfold(text: string): string[] {
  const raw = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const out: string[] = [];
  for (const line of raw) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && out.length) {
      out[out.length - 1] += line.slice(1);
    } else {
      out.push(line);
    }
  }
  return out;
}

function decode(value: string, params: string): string {
  let v = value;
  if (/ENCODING=QUOTED-PRINTABLE/i.test(params)) {
    v = v.replace(/=([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
  }
  return v.replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\n/gi, " ").trim();
}

/** Parse a vCard (.vcf) file that may contain many VCARD blocks. */
export function parseVCards(text: string): ParsedContact[] {
  const lines = unfold(text);
  const contacts: ParsedContact[] = [];
  let cur: ParsedContact | null = null;

  for (const line of lines) {
    const upper = line.toUpperCase();
    if (upper.startsWith("BEGIN:VCARD")) { cur = { source: "iphone-import" }; continue; }
    if (upper.startsWith("END:VCARD")) { if (cur && (cur.email || cur.phone || cur.first_name)) contacts.push(cur); cur = null; continue; }
    if (!cur) continue;

    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const head = line.slice(0, colon);
    const value = line.slice(colon + 1);
    const name = head.split(";")[0].toUpperCase();

    if (name === "FN") {
      const fn = decode(value, head);
      if (fn && !cur.first_name && !cur.last_name) {
        const parts = fn.split(" ");
        cur.first_name = parts[0];
        cur.last_name = parts.slice(1).join(" ") || undefined;
      }
    } else if (name === "N") {
      const [last, first] = decode(value, head).split(";");
      if (first) cur.first_name = first.trim();
      if (last) cur.last_name = last.trim();
    } else if (name === "TEL") {
      if (!cur.phone) cur.phone = decode(value, head);
    } else if (name === "EMAIL") {
      if (!cur.email) cur.email = decode(value, head);
    } else if (name === "ADR") {
      if (!cur.address) cur.address = decode(value, head).split(";").filter(Boolean).join(", ");
    }
  }
  return contacts;
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

/** Parse a CSV with a header row; maps common name/email/phone/address columns. */
export function parseCsv(text: string): ParsedContact[] {
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n").filter((l) => l.trim());
  if (lines.length < 2) return [];
  const headers = splitCsvLine(lines[0]).map((h) => h.toLowerCase());
  const idx = (names: string[]) => headers.findIndex((h) => names.includes(h));
  const iFirst = idx(["first name", "first_name", "firstname", "given name"]);
  const iLast = idx(["last name", "last_name", "lastname", "family name", "surname"]);
  const iName = idx(["name", "full name", "fullname"]);
  const iEmail = idx(["email", "e-mail", "email address"]);
  const iPhone = idx(["phone", "mobile", "phone number", "cell", "telephone"]);
  const iAddr = idx(["address", "street", "mailing address"]);

  const out: ParsedContact[] = [];
  for (let r = 1; r < lines.length; r++) {
    const cols = splitCsvLine(lines[r]);
    const c: ParsedContact = { source: "csv-import" };
    if (iFirst >= 0) c.first_name = cols[iFirst] || undefined;
    if (iLast >= 0) c.last_name = cols[iLast] || undefined;
    if (iName >= 0 && !c.first_name) {
      const parts = (cols[iName] || "").split(" ");
      c.first_name = parts[0] || undefined;
      c.last_name = parts.slice(1).join(" ") || undefined;
    }
    if (iEmail >= 0) c.email = cols[iEmail] || undefined;
    if (iPhone >= 0) c.phone = cols[iPhone] || undefined;
    if (iAddr >= 0) c.address = cols[iAddr] || undefined;
    if (c.email || c.phone || c.first_name) out.push(c);
  }
  return out;
}

export function parseContactsFile(filename: string, text: string): ParsedContact[] {
  return filename.toLowerCase().endsWith(".csv") ? parseCsv(text) : parseVCards(text);
}
