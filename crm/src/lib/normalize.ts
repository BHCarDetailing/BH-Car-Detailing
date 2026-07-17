export function normalizeEmail(raw?: string | null): string | null {
  if (!raw) return null;
  const e = raw.trim().toLowerCase();
  return e.includes("@") && e.length >= 5 ? e : null;
}

export function normalizePhone(raw?: string | null): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return "+1" + digits;
  if (digits.length === 11 && digits.startsWith("1")) return "+" + digits;
  if (raw.trim().startsWith("+") && digits.length >= 8 && digits.length <= 15) return "+" + digits;
  return null;
}

export function cleanName(raw?: string | null): string | null {
  if (!raw) return null;
  const n = raw.replace(/\s+/g, " ").trim();
  if (!n) return null;
  if (n === n.toUpperCase() || n === n.toLowerCase()) {
    return n
      .split(" ")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join(" ");
  }
  return n;
}

export function vehicleSizeClass(
  raw?: string | null
): "sedan" | "suv" | "truck" | "van" | "exotic" | "other" {
  const v = (raw ?? "").toLowerCase();
  if (v.includes("exotic") || v.includes("luxury")) return "exotic";
  if (v.includes("suv") || v.includes("crossover")) return "suv";
  if (v.includes("van")) return "van";
  if (v.includes("truck")) return "truck";
  if (v.includes("sedan") || v.includes("coupe") || v.includes("convertible")) return "sedan";
  return "other";
}
