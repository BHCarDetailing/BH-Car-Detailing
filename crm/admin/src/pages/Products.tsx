import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { EmptyState, PageHeader, Skeleton, Tag } from "../components/ui";

/**
 * The service menu, filterable.
 *
 * This reads from Services — the same rows that price the quote builder and the
 * public booking page — so a price only ever lives in one place. The old
 * products table held its own copies, which is how "Full Detail (Sedan)" and
 * "Full Detail — Sedan" both ended up on the menu at different prices.
 *
 * Filtering runs in the browser: the whole menu is a couple of dozen rows, and
 * stacking a filter should feel instant rather than like a page load.
 */

interface Service {
  id: string;
  name: string;
  description: string | null;
  size_pricing: Record<string, number>;
  base_price_cents: number;
  area: string | null;
  level: string | null;
  duration_min: number | null;
  is_addon: boolean;
  active: boolean;
  created_at?: string;
}

interface VehicleTypeOption { value: string; label: string; bucket: string }

const VEHICLE_FILTERS = [
  { value: "sedan", label: "Sedan" },
  { value: "suv", label: "SUV" },
  { value: "truck", label: "Truck" },
  { value: "van", label: "Van" },
  { value: "exotic", label: "Exotic" },
];
const AREA_FILTERS = [
  { value: "interior", label: "Interior" },
  { value: "exterior", label: "Exterior" },
  { value: "both", label: "Both" },
];
const LEVEL_FILTERS = [
  { value: "maintenance", label: "Maintenance Wash" },
  { value: "light", label: "Light Detail" },
  { value: "full", label: "Full Detail" },
  { value: "specialty", label: "Specialty" },
];
const STATUS_FILTERS = [
  { value: "active", label: "Active" },
  { value: "hidden", label: "Hidden" },
  { value: "addon", label: "Add-ons" },
];

const SORTS = [
  { value: "level", label: "Service level" },
  { value: "price_asc", label: "Price — low to high" },
  { value: "price_desc", label: "Price — high to low" },
  { value: "alpha", label: "A–Z" },
  { value: "duration", label: "Duration" },
  { value: "recent", label: "Recently added" },
];

const money = (c: number) => `$${(c / 100).toFixed(c % 100 === 0 ? 0 : 2)}`;
const LEVEL_RANK: Record<string, number> = { maintenance: 0, light: 1, full: 2, specialty: 3 };

function dur(mins: number | null): string {
  if (!mins) return "—";
  const h = Math.floor(mins / 60), m = mins % 60;
  return h ? `${h}h${m ? ` ${m}m` : ""}` : `${m}m`;
}

/** Price span across the sizes currently filtered on (all sizes when unfiltered). */
function priceRange(s: Service, buckets: string[]): { min: number; max: number } {
  const keys = buckets.length ? buckets : Object.keys(s.size_pricing);
  const vals = keys.map((k) => s.size_pricing[k]).filter((v): v is number => Number.isFinite(v) && v > 0);
  if (!vals.length) return { min: s.base_price_cents, max: s.base_price_cents };
  return { min: Math.min(...vals), max: Math.max(...vals) };
}

function FilterChip({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
      className={`min-h-[36px] rounded-full border px-3 py-1.5 text-sm font-medium transition ${
        on ? "border-red-500 bg-red-50 text-red-700" : "border-neutral-200 bg-white text-neutral-600 hover:border-neutral-300"
      }`}>
      {label}
    </button>
  );
}

function FilterGroup({ title, options, selected, onToggle }: {
  title: string;
  options: { value: string; label: string }[];
  selected: string[];
  onToggle: (v: string) => void;
}) {
  return (
    <div>
      <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-neutral-400">{title}</div>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => (
          <FilterChip key={o.value} label={o.label} on={selected.includes(o.value)} onClick={() => onToggle(o.value)} />
        ))}
      </div>
    </div>
  );
}

export default function Products() {
  const [items, setItems] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);
  const [vehicles, setVehicles] = useState<string[]>([]);
  const [areas, setAreas] = useState<string[]>([]);
  const [levels, setLevels] = useState<string[]>([]);
  const [statuses, setStatuses] = useState<string[]>(["active"]);
  const [q, setQ] = useState("");
  const [minPrice, setMinPrice] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [sort, setSort] = useState("level");
  const [types, setTypes] = useState<VehicleTypeOption[]>([]);

  useEffect(() => {
    Promise.all([
      api<{ items: Service[] }>("/api/services"),
      api<{ vehicle_types: VehicleTypeOption[] }>("/api/services/vocab"),
    ])
      .then(([s, v]) => { setItems(s.items); setTypes(v.vehicle_types); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const toggle = (list: string[], set: (v: string[]) => void) => (v: string) =>
    set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  const filtered = useMemo(() => {
    const min = minPrice.trim() ? Number(minPrice) * 100 : null;
    const max = maxPrice.trim() ? Number(maxPrice) * 100 : null;
    const needle = q.trim().toLowerCase();
    const wantAddons = statuses.includes("addon");

    const out = items.filter((s) => {
      // Add-ons are sold alongside a service, so they stay out of the menu
      // unless asked for explicitly.
      if (s.is_addon !== wantAddons) return false;
      if (statuses.includes("active") && !statuses.includes("hidden") && !s.active) return false;
      if (statuses.includes("hidden") && !statuses.includes("active") && s.active) return false;

      if (needle && !`${s.name} ${s.description ?? ""}`.toLowerCase().includes(needle)) return false;
      if (areas.length && !areas.includes(s.area ?? "")) return false;
      if (levels.length && !levels.includes(s.level ?? "")) return false;
      // Vehicle: keep anything actually priced for one of the chosen sizes.
      if (vehicles.length && !vehicles.some((v) => (s.size_pricing[v] ?? 0) > 0)) return false;

      const { min: lo, max: hi } = priceRange(s, vehicles);
      if (min != null && hi < min) return false;
      if (max != null && lo > max) return false;
      return true;
    });

    const low = (s: Service) => priceRange(s, vehicles).min;
    out.sort((a, b) => {
      switch (sort) {
        case "price_asc": return low(a) - low(b);
        case "price_desc": return low(b) - low(a);
        case "alpha": return a.name.localeCompare(b.name);
        case "duration": return (a.duration_min ?? 0) - (b.duration_min ?? 0);
        case "recent": return (b.created_at ?? "").localeCompare(a.created_at ?? "");
        default:
          return (LEVEL_RANK[a.level ?? ""] ?? 9) - (LEVEL_RANK[b.level ?? ""] ?? 9) || a.name.localeCompare(b.name);
      }
    });
    return out;
  }, [items, vehicles, areas, levels, statuses, q, minPrice, maxPrice, sort]);

  const activeFilterCount = vehicles.length + areas.length + levels.length
    + (q.trim() ? 1 : 0) + (minPrice.trim() ? 1 : 0) + (maxPrice.trim() ? 1 : 0);

  function clearAll() {
    setVehicles([]); setAreas([]); setLevels([]); setStatuses(["active"]);
    setQ(""); setMinPrice(""); setMaxPrice("");
  }

  return (
    <div className="mx-auto max-w-5xl p-4 md:p-8">
      <PageHeader
        eyebrow="Menu"
        title="Services & pricing"
        subtitle="The one menu behind the quote builder and the booking page. Edit prices in Settings → Services."
        action={<Link to="/quote-builder" className="inline-flex min-h-[40px] items-center rounded-lg bg-red-600 px-4 text-sm font-medium text-white">Build a quote</Link>}
      />

      <div className="mb-5 space-y-4 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-neutral-100">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search services…"
          className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-red-400 focus:ring-2 focus:ring-red-100"
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <FilterGroup title="Vehicle" options={VEHICLE_FILTERS} selected={vehicles} onToggle={toggle(vehicles, setVehicles)} />
          <FilterGroup title="Area" options={AREA_FILTERS} selected={areas} onToggle={toggle(areas, setAreas)} />
          <FilterGroup title="Level" options={LEVEL_FILTERS} selected={levels} onToggle={toggle(levels, setLevels)} />
          <FilterGroup title="Status" options={STATUS_FILTERS} selected={statuses} onToggle={toggle(statuses, setStatuses)} />
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-neutral-400">Price</div>
            <div className="flex items-center gap-2">
              <input value={minPrice} onChange={(e) => setMinPrice(e.target.value)} inputMode="decimal" placeholder="Min"
                className="w-24 rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-red-400" />
              <span className="text-neutral-300">–</span>
              <input value={maxPrice} onChange={(e) => setMaxPrice(e.target.value)} inputMode="decimal" placeholder="Max"
                className="w-24 rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-red-400" />
            </div>
          </div>
          <div className="min-w-[180px] flex-1">
            <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-neutral-400">Sort</div>
            <select value={sort} onChange={(e) => setSort(e.target.value)}
              className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-red-400">
              {SORTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>
          {activeFilterCount > 0 && (
            <button onClick={clearAll} className="pb-2 text-sm text-neutral-500 underline">Clear ({activeFilterCount})</button>
          )}
        </div>
      </div>

      <div className="mb-3 text-sm text-neutral-500">
        {loading ? "Loading…" : `${filtered.length} of ${items.length} service${items.length === 1 ? "" : "s"}`}
      </div>

      {loading ? (
        <div className="space-y-2"><Skeleton className="h-24 w-full" /><Skeleton className="h-24 w-full" /><Skeleton className="h-24 w-full" /></div>
      ) : filtered.length === 0 ? (
        <EmptyState title="Nothing matches those filters" hint="Try clearing one — vehicle and level together can be a narrow combination." />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {filtered.map((s) => {
            const { min, max } = priceRange(s, vehicles);
            const unpriced = min <= 0;
            return (
              <li key={s.id} className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-neutral-100">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-semibold text-neutral-900">{s.name}</span>
                  <span className="shrink-0 font-bold text-neutral-900">
                    {unpriced ? "—" : min === max ? money(min) : `${money(min)}–${money(max)}`}
                  </span>
                </div>
                {s.description && <p className="mt-1 text-sm text-neutral-500">{s.description}</p>}
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  {s.is_addon && <Tag color="brand">ADD-ON</Tag>}
                  {s.area && s.area !== "specialty" && <Tag color="blue">{s.area.toUpperCase()}</Tag>}
                  {s.level && <Tag color="neutral">{(LEVEL_FILTERS.find((l) => l.value === s.level)?.label ?? s.level).toUpperCase()}</Tag>}
                  {!s.active && <Tag color="amber">HIDDEN</Tag>}
                  <span className="ml-auto text-xs text-neutral-400">{dur(s.duration_min)}</span>
                </div>
                {unpriced && (
                  <p className="mt-2 rounded-lg bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800">
                    No price set — hidden from the quote builder until you price it in Settings → Services.
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {types.length > 0 && (
        <p className="mt-6 text-xs text-neutral-400">
          Customers choose from {types.length} vehicle types in the quote builder; each bills as one of the size tiers above.
        </p>
      )}
    </div>
  );
}
