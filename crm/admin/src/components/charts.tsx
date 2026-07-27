/* Hand-rolled SVG charts — no charting library (keeps the bundle lean, same
   approach as the Dashboard's MonthBars). Brand-red line + soft area fill. */

export interface Point { label: string; value: number }

/** Responsive line chart with area fill, dots, and x-axis labels. */
export function LineChart({ points, height = 180, fmt = (n) => String(n) }: {
  points: Point[]; height?: number; fmt?: (n: number) => string;
}) {
  if (points.length === 0) {
    return <div className="grid h-[180px] place-items-center rounded-xl bg-steel-50 text-sm text-chrome-400">No data yet</div>;
  }
  const W = 640, H = height, padX = 8, padTop = 16, padBottom = 26;
  const max = Math.max(1, ...points.map((p) => p.value));
  const min = Math.min(0, ...points.map((p) => p.value));
  const span = max - min || 1;
  const n = points.length;
  const x = (i: number) => padX + (n === 1 ? W / 2 - padX : (i * (W - padX * 2)) / (n - 1));
  const y = (v: number) => padTop + (1 - (v - min) / span) * (H - padTop - padBottom);

  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const area = `${line} L${x(n - 1).toFixed(1)},${(H - padBottom).toFixed(1)} L${x(0).toFixed(1)},${(H - padBottom).toFixed(1)} Z`;
  const showEvery = Math.ceil(n / 8); // avoid label crowding

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" preserveAspectRatio="none" style={{ height }}>
      <defs>
        <linearGradient id="bhArea" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#c8102e" stopOpacity="0.22" />
          <stop offset="100%" stopColor="#c8102e" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#bhArea)" />
      <path d={line} fill="none" stroke="#c8102e" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      <text x={padX} y={12} fontSize="11" fill="#9aa3af">{fmt(max)}</text>
      {points.map((p, i) => (
        <g key={i}>
          <circle cx={x(i)} cy={y(p.value)} r="3" fill="#c8102e" />
          {i % showEvery === 0 && (
            <text x={x(i)} y={H - 8} textAnchor="middle" fontSize="11" fill="#9aa3af">{p.label}</text>
          )}
        </g>
      ))}
    </svg>
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
      <polyline points={pts} fill="none" stroke={up ? "#10b981" : "#f43f5e"} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
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
