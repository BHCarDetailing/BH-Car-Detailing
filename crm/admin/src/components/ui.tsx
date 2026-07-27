import { useEffect, useState, type ReactNode } from "react";
import { fmtDate, fmtDateTime, relTime } from "../lib/datetime";

/* Reusable, premium UI primitives shared by every operating-system page.
   Kept intentionally small and composable — modals, tags, headers, fields. */

const TAG_COLORS: Record<string, string> = {
  neutral: "bg-neutral-100 text-neutral-700 ring-neutral-200",
  brand: "bg-red-50 text-red-700 ring-red-100",
  red: "bg-rose-50 text-rose-700 ring-rose-100",
  green: "bg-emerald-50 text-emerald-700 ring-emerald-100",
  blue: "bg-sky-50 text-sky-700 ring-sky-100",
  amber: "bg-amber-50 text-amber-700 ring-amber-100",
  violet: "bg-violet-50 text-violet-700 ring-violet-100",
};

/**
 * Brand logo. The source art has a light background, so on dark surfaces it
 * sits on a clean white "chip" (rounded, subtle ring) to stay legible and
 * consistent; on light surfaces render it plain.
 */
export function BrandLogo({ h = "h-9", chip = false, className = "" }: { h?: string; chip?: boolean; className?: string }) {
  const img = <img src="/brand/logo.png" alt="BH Car Detailing" className={`${h} w-auto ${chip ? "" : className}`} />;
  if (!chip) return img;
  return (
    <span className={`inline-flex items-center justify-center rounded-xl bg-white px-2.5 py-1.5 shadow-sm ring-1 ring-black/5 ${className}`}>
      {img}
    </span>
  );
}

export function Tag({ color = "neutral", children }: { color?: string; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${TAG_COLORS[color] ?? TAG_COLORS.neutral}`}>
      {children}
    </span>
  );
}

export function PageHeader({ title, subtitle, action, eyebrow }: { title: string; subtitle?: string; action?: ReactNode; eyebrow?: string }) {
  return (
    <div className="mb-7 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow && (
          <div className="mb-1.5 flex items-center gap-2">
            <span className="h-3 w-1 -skew-x-12 rounded-sm bg-red-600" />
            <span className="eyebrow text-[11px] text-red-600">{eyebrow}</span>
          </div>
        )}
        <h1 className="font-display text-3xl leading-none text-graphite-950">{title}</h1>
        {subtitle && <p className="mt-2 text-sm text-chrome-400">{subtitle}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function Button({
  children, onClick, variant = "primary", type = "button", disabled, className = "",
}: {
  children: ReactNode; onClick?: () => void; variant?: "primary" | "ghost" | "danger" | "subtle";
  type?: "button" | "submit"; disabled?: boolean; className?: string;
}) {
  const styles = {
    primary: "bg-gradient-to-b from-red-500 to-red-600 text-white shadow-sm shadow-red-600/25 ring-1 ring-inset ring-white/10 hover:from-red-500 hover:to-red-500",
    ghost: "bg-white text-graphite-900 ring-1 ring-inset ring-steel-200 hover:bg-steel-50",
    subtle: "bg-steel-100 text-graphite-800 hover:bg-steel-200",
    danger: "bg-white text-rose-600 ring-1 ring-inset ring-rose-200 hover:bg-rose-50",
  }[variant];
  return (
    <button type={type} onClick={onClick} disabled={disabled}
      className={`inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-lg px-3.5 text-sm font-medium transition disabled:opacity-50 ${styles} ${className}`}>
      {children}
    </button>
  );
}

export function Modal({ open, onClose, title, children, footer, size = "md" }: {
  open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode;
  size?: "sm" | "md" | "lg";
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = ""; };
  }, [open, onClose]);
  if (!open) return null;
  const w = { sm: "max-w-sm", md: "max-w-lg", lg: "max-w-2xl" }[size];
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-neutral-900/50 p-4 backdrop-blur-sm sm:items-center" onMouseDown={onClose}>
      <div className={`w-full ${w} rounded-2xl bg-white shadow-2xl`} onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-neutral-100 px-5 py-4">
          <h2 className="text-base font-semibold text-neutral-900">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="grid h-9 w-9 place-items-center rounded-lg text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-neutral-100 px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-neutral-600">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-neutral-400">{hint}</span>}
    </label>
  );
}

const inputCls = "w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 outline-none placeholder:text-neutral-400 focus:border-red-400 focus:ring-2 focus:ring-red-100";

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${inputCls} ${props.className ?? ""}`} />;
}
export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`${inputCls} min-h-[90px] resize-y ${props.className ?? ""}`} />;
}
export function Select({ options, ...props }: React.SelectHTMLAttributes<HTMLSelectElement> & { options: readonly { value: string; label: string }[] }) {
  return (
    <select {...props} className={`${inputCls} ${props.className ?? ""}`}>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

export function Toolbar({ search, onSearch, placeholder = "Search…", children }: {
  search?: string; onSearch?: (v: string) => void; placeholder?: string; children?: ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      {onSearch && (
        <div className="relative flex-1 min-w-[180px]">
          <svg className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4-4" /></svg>
          <input value={search ?? ""} onChange={(e) => onSearch(e.target.value)} placeholder={placeholder}
            className="w-full rounded-lg border border-neutral-200 bg-white py-2 pl-9 pr-3 text-sm outline-none focus:border-red-400 focus:ring-2 focus:ring-red-100" />
        </div>
      )}
      {children}
    </div>
  );
}

export function EmptyState({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-neutral-200 bg-neutral-50/50 px-6 py-14 text-center">
      <p className="text-sm font-medium text-neutral-700">{title}</p>
      {hint && <p className="mx-auto mt-1 max-w-sm text-sm text-neutral-400">{hint}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-2xl bg-white p-5 shadow-sm ring-1 ring-neutral-100 ${className}`}>{children}</div>;
}

/**
 * Universal timestamp — the app-wide standard for showing when something was
 * created/updated. Renders relative time with the exact date+time on hover,
 * or the full stamp inline when `full`. Use everywhere an entity has a date.
 */
export function Timestamp({ value, full = false, prefix, className = "" }: {
  value?: string | null; full?: boolean; prefix?: string; className?: string;
}) {
  if (!value) return null;
  const rel = relTime(value);
  if (full) {
    return <span className={`text-xs text-chrome-400 ${className}`} title={fmtDateTime(value)}>{prefix ? `${prefix} ` : ""}{fmtDate(value)} · {rel}</span>;
  }
  return <span className={`text-xs text-chrome-400 ${className}`} title={fmtDateTime(value)}>{prefix ? `${prefix} ` : ""}{rel}</span>;
}

/** Segmented tabs. Controlled via value/onChange. */
export function Tabs({ tabs, value, onChange }: {
  tabs: readonly { value: string; label: string }[]; value: string; onChange: (v: string) => void;
}) {
  return (
    <div className="mb-5 inline-flex flex-wrap gap-1 rounded-xl bg-steel-100 p-1 ring-1 ring-inset ring-steel-200">
      {tabs.map((t) => (
        <button key={t.value} onClick={() => onChange(t.value)}
          className={`rounded-lg px-3.5 py-1.5 text-sm font-medium transition ${
            value === t.value ? "bg-white text-graphite-950 shadow-sm ring-1 ring-steel-200" : "text-chrome-400 hover:text-graphite-800"
          }`}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

/** Compact hook for tab state. */
export function useTabs(initial: string) {
  return useState(initial);
}

/** Metric tile — label + big display-face value + optional sub/delta. */
export function StatTile({ label, value, sub, tone = "light" }: {
  label: string; value: ReactNode; sub?: ReactNode; tone?: "light" | "dark" | "brand";
}) {
  const cls = tone === "dark"
    ? "bg-gradient-to-br from-graphite-900 to-graphite-950 text-white ring-white/5 bh-gloss"
    : "bg-white ring-steel-200";
  const valCls = tone === "brand" ? "text-red-600" : tone === "dark" ? "text-white" : "text-graphite-950";
  return (
    <div className={`rounded-2xl p-4 shadow-sm ring-1 ${cls}`}>
      <div className="eyebrow text-[10px] text-chrome-400">{label}</div>
      <div className={`font-display mt-1.5 text-2xl leading-none ${valCls}`}>{value}</div>
      {sub != null && <div className="mt-1 text-xs text-chrome-400">{sub}</div>}
    </div>
  );
}

/** Small icon delete button used across list/table rows. */
export function DeleteButton({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} aria-label="Delete" className="grid h-8 w-8 place-items-center rounded-lg text-neutral-300 hover:bg-rose-50 hover:text-rose-500">
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13" /></svg>
    </button>
  );
}
