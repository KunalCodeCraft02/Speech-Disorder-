// Dependency-free SVG line chart for the Analytics tab. Ported in spirit
// from apps/dashboard's old Recharts-based TrendChart (see git history at
// ef09ce7~1) but hand-rolled here with no chart library dependency, to
// keep this an offline-first mobile bundle small. Same visual language:
// gradient-filled line over a dark surface, plus a baseline mean±1std band
// (new here -- the old dashboard never had one) shaded behind the line.

import { NA } from '../lib/formatMetric';

const WIDTH = 320;
const HEIGHT = 120;
const PAD_X = 8;
const PAD_TOP = 10;
const PAD_BOTTOM = 10;

export interface TrendPoint {
  ts: number;
  value: number | null;
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

export function LiveTrendChart({
  title,
  unit,
  points,
  color,
  domain,
  baselineMean,
  baselineStd,
  formatValue,
}: {
  title: string;
  unit: string;
  points: TrendPoint[];
  color: string;
  domain: [number, number];
  baselineMean?: number | null;
  baselineStd?: number | null;
  formatValue?: (v: number) => string;
}) {
  const usable = points.filter((p) => p.value != null && Number.isFinite(p.value)) as Array<{ ts: number; value: number }>;
  const fmt = formatValue ?? ((v: number) => v.toFixed(1));
  const lastValue = usable.length ? usable[usable.length - 1].value : null;

  const [domainMin, domainMax] = domain;
  const span = Math.max(1e-6, domainMax - domainMin);
  const yScale = (v: number) => PAD_TOP + (1 - (clamp(v, domainMin, domainMax) - domainMin) / span) * (HEIGHT - PAD_TOP - PAD_BOTTOM);

  const tsMin = points.length ? points[0].ts : 0;
  const tsMax = points.length ? points[points.length - 1].ts : 1;
  const tsSpan = Math.max(1, tsMax - tsMin);
  const xScale = (ts: number) => PAD_X + ((ts - tsMin) / tsSpan) * (WIDTH - PAD_X * 2);

  const gradientId = `grad-${title.replace(/\s+/g, '-')}`;

  // Break the polyline at gaps (null readings) instead of interpolating across them.
  const segments: Array<Array<{ x: number; y: number }>> = [];
  let current: Array<{ x: number; y: number }> = [];
  for (const p of points) {
    if (p.value == null) {
      if (current.length) segments.push(current);
      current = [];
      continue;
    }
    current.push({ x: xScale(p.ts), y: yScale(p.value) });
  }
  if (current.length) segments.push(current);

  const linePath = segments.map((seg) => 'M ' + seg.map((pt) => `${pt.x.toFixed(1)},${pt.y.toFixed(1)}`).join(' L ')).join(' ');
  const lastSeg = segments[segments.length - 1];
  const lastPoint = lastSeg?.[lastSeg.length - 1];

  const areaSegments = segments.map((seg) => {
    if (seg.length < 2) return null;
    const baseline = HEIGHT - PAD_BOTTOM;
    const first = seg[0];
    const last = seg[seg.length - 1];
    return `M ${first.x.toFixed(1)},${baseline} L ${seg.map((pt) => `${pt.x.toFixed(1)},${pt.y.toFixed(1)}`).join(' L ')} L ${last.x.toFixed(1)},${baseline} Z`;
  });

  const bandTop = baselineMean != null && baselineStd != null ? yScale(baselineMean + baselineStd) : null;
  const bandBottom = baselineMean != null && baselineStd != null ? yScale(baselineMean - baselineStd) : null;
  const meanY = baselineMean != null ? yScale(baselineMean) : null;

  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-xs font-semibold text-[var(--color-ink-secondary)]">{title}</span>
        <span className="tabular-nums text-sm font-semibold" style={{ color }}>
          {lastValue != null ? fmt(lastValue) : NA}
          {unit && <span className="ml-0.5 text-[10px] font-normal text-[var(--color-ink-muted)]">{unit}</span>}
        </span>
      </div>

      {usable.length === 0 ? (
        <div className="flex h-[120px] items-center justify-center text-xs text-[var(--color-ink-muted)]">Waiting for data…</div>
      ) : (
        <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} width="100%" height={HEIGHT} preserveAspectRatio="none" role="img" aria-label={`${title} trend`}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.32} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>

          {bandTop != null && bandBottom != null && (
            <rect x={PAD_X} y={bandTop} width={WIDTH - PAD_X * 2} height={Math.max(0, bandBottom - bandTop)} fill="var(--color-good)" fillOpacity={0.1} />
          )}
          {meanY != null && (
            <line x1={PAD_X} x2={WIDTH - PAD_X} y1={meanY} y2={meanY} stroke="var(--color-good)" strokeOpacity={0.45} strokeWidth={1} strokeDasharray="3 3" />
          )}

          {areaSegments.map(
            (d, i) => d && <path key={i} d={d} fill={`url(#${gradientId})`} stroke="none" />
          )}

          <path d={linePath} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />

          {lastPoint && <circle cx={lastPoint.x} cy={lastPoint.y} r={3.5} fill={color} stroke="var(--color-surface)" strokeWidth={1.5} />}
        </svg>
      )}
    </div>
  );
}
