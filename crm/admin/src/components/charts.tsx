import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/**
 * Hand-rolled SVG charts — no charting library, to keep the bundle lean.
 *
 * These render at the container's true pixel size rather than stretching a
 * fixed viewBox. The old chart used preserveAspectRatio="none", which scaled
 * the whole drawing horizontally — including the labels, which is why the type
 * looked squashed and the line weight varied with window width.
 */

export interface Point { label: string; value: number }

const BRAND = "#c8102e";
const UP = "#0f9d68";
const DOWN = "#e5484d";

/** Container width, tracked so the chart can draw 1:1 with real pixels. */
function useWidth<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setW(Math.round(entry.contentRect.width)));
    ro.observe(el);
    setW(Math.round(el.getBoundingClientRect().width));
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

/** "Nice" round gridline steps, so the axis reads 0 / 500 / 1,000 rather than 0 / 437 / 874. */
function niceTicks(max: number, count = 4): number[] {
  if (max <= 0) return [0];
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? mag * 10;
  const out: number[] = [];
  for (let v = 0; v <= max + step * 0.001; v += step) out.push(v);
  return out;
}

/**
 * Interactive trend chart in the shape of a trading view: gridlines, an area
 * under the line, a crosshair, and a readout that follows your finger.
 *
 * Drag (or hold) anywhere to scrub. The line takes its colour from the
 * direction of travel across the period, the way a price chart does.
 */
export function LineChart({ points, height = 240, fmt = (n) => String(n), label = "Revenue" }: {
  points: Point[];
  height?: number;
  fmt?: (n: number) => string;
  label?: string;
}) {
  const [wrapRef, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const [pinned, setPinned] = useState(false);

  const W = Math.max(width, 240);
  const padL = 52, padR = 12, padTop = 14, padBottom = 28;
  const plotW = Math.max(1, W - padL - padR);
  const plotH = Math.max(1, height - padTop - padBottom);

  const n = points.length;
  const values = points.map((p) => p.value);
  const rawMax = Math.max(1, ...values);
  const ticks = useMemo(() => niceTicks(rawMax), [rawMax]);
  const max = Math.max(rawMax, ticks[ticks.length - 1] ?? rawMax);

  const x = useCallback(
    (i: number) => padL + (n <= 1 ? plotW / 2 : (i * plotW) / (n - 1)),
    [n, plotW, padL]
  );
  const y = useCallback((v: number) => padTop + (1 - v / max) * plotH, [max, plotH, padTop]);

  const peakIndex = values.indexOf(Math.max(...values));
  const trendUp = n > 1 ? values[n - 1] >= values[0] : true;
  const stroke = n > 1 ? (trendUp ? UP : DOWN) : BRAND;

  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const area = n
    ? `${line} L${x(n - 1).toFixed(1)},${(padTop + plotH).toFixed(1)} L${x(0).toFixed(1)},${(padTop + plotH).toFixed(1)} Z`
    : "";

  /** Nearest point to the pointer — scrubbing should never feel like it missed. */
  const pick = useCallback((clientX: number) => {
    const el = wrapRef.current;
    if (!el || n === 0) return;
    const rect = el.getBoundingClientRect();
    const rel = clientX - rect.left;
    const i = n === 1 ? 0 : Math.round(((rel - padL) / plotW) * (n - 1));
    setActive(Math.max(0, Math.min(n - 1, i)));
  }, [n, plotW, padL, wrapRef]);

  if (n === 0) {
    return (
      <div className="grid place-items-center rounded-xl bg-steel-50 text-sm text-chrome-400" style={{ height }}>
        No data yet
      </div>
    );
  }

  const shown = active != null ? points[active] : null;
  const showLabelEvery = Math.max(1, Math.ceil(n / (W < 420 ? 4 : 8)));

  return (
    <div ref={wrapRef} className="relative select-none" style={{ height }}>
      {width > 0 && (
        <svg
          width={W}
          height={height}
          className="block"
          style={{ touchAction: "pan-y" }}
          onPointerDown={(e) => { setPinned(true); pick(e.clientX); }}
          onPointerMove={(e) => { if (pinned || e.pointerType === "mouse") pick(e.clientX); }}
          onPointerUp={() => setPinned(false)}
          onPointerCancel={() => { setPinned(false); setActive(null); }}
          onPointerLeave={() => { if (!pinned) setActive(null); }}
        >
          <defs>
            <linearGradient id="bhArea" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={stroke} stopOpacity="0.20" />
              <stop offset="100%" stopColor={stroke} stopOpacity="0" />
            </linearGradient>
          </defs>

          {/* Gridlines + value axis */}
          {ticks.map((t) => (
            <g key={t}>
              <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} stroke="#eceef1" strokeWidth="1" />
              <text x={padL - 8} y={y(t) + 4} textAnchor="end" fontSize="11" fontFamily="inherit" fill="#9aa3af">
                {fmt(t)}
              </text>
            </g>
          ))}

          <path d={area} fill="url(#bhArea)" />
          <path d={line} fill="none" stroke={stroke} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />

          {/* The peak — the number worth knowing at a glance. */}
          {n > 1 && (
            <circle cx={x(peakIndex)} cy={y(values[peakIndex])} r="3.5" fill="none" stroke={stroke} strokeWidth="2" />
          )}

          {/* Time axis */}
          {points.map((p, i) =>
            i % showLabelEvery === 0 || i === n - 1 ? (
              <text key={i} x={x(i)} y={height - 8} textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"}
                fontSize="11" fontFamily="inherit" fill="#9aa3af">
                {p.label}
              </text>
            ) : null
          )}

          {/* Crosshair */}
          {active != null && (
            <g>
              <line x1={x(active)} x2={x(active)} y1={padTop} y2={padTop + plotH} stroke="#c8ccd2" strokeWidth="1" strokeDasharray="3 3" />
              <circle cx={x(active)} cy={y(points[active].value)} r="5" fill="#fff" stroke={stroke} strokeWidth="2.5" />
            </g>
          )}
        </svg>
      )}

      {/* Readout. HTML rather than SVG text so it inherits the app's font cleanly. */}
      {shown && (
        <div
          className="pointer-events-none absolute top-1 rounded-lg bg-graphite-950/95 px-2.5 py-1.5 text-white shadow-lg"
          style={{
            left: Math.min(Math.max(x(active!) - 52, 4), Math.max(4, W - 108)),
            minWidth: 96,
          }}
        >
          <div className="text-[10px] uppercase tracking-wide text-chrome-400">{shown.label}</div>
          <div className="font-display text-base leading-tight">{fmt(shown.value)}</div>
          {active === peakIndex && n > 1 && (
            <div className="text-[10px] font-medium text-emerald-300">peak {label.toLowerCase()}</div>
          )}
        </div>
      )}
    </div>
  );
}

/** Tiny inline trend sparkline. */
export function Sparkline({ values, width = 90, height = 28 }: { values: number[]; width?: number; height?: number }) {
  if (values.length < 2) return null;
  const max = Math.max(1, ...values), min = Math.min(0, ...values), span = max - min || 1;
  const pts = values.map((v, i) => `${(i * width) / (values.length - 1)},${height - ((v - min) / span) * height}`).join(" ");
  const up = values[values.length - 1] >= values[0];
  return (
    <svg width={width} height={height} className="overflow-visible">
      <polyline points={pts} fill="none" stroke={up ? UP : DOWN} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

/** Up/down delta pill vs a prior value. */
export function Delta({ current, prior, fmt = (n) => String(n) }: { current: number; prior: number; fmt?: (n: number) => string }) {
  if (!prior && !current) return null;
  const diff = current - prior;
  const pct = prior ? Math.round((diff / prior) * 100) : null;
  const up = diff >= 0;
  if (diff === 0) return <span className="text-xs text-chrome-400">no change</span>;
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-medium ${up ? "text-emerald-600" : "text-rose-600"}`}>
      {up ? "▲" : "▼"} {pct !== null ? `${Math.abs(pct)}%` : fmt(Math.abs(diff))}
    </span>
  );
}
