import { RadialBar, RadialBarChart, PolarAngleAxis } from 'recharts';

interface GaugeProps {
  label: string;
  value: number | null;
  min: number;
  max: number;
  unit: string;
  color: string;
  precision?: number;
  targetMin?: number;
  targetMax?: number;
}

/**
 * A single radial gauge. `targetMin`/`targetMax` (when given) render a
 * calibrated "in range" band as a dimmed track so a clinician can see at a
 * glance whether the live value sits inside the patient's baseline window.
 */
export function Gauge({ label, value, min, max, unit, color, precision = 0, targetMin, targetMax }: GaugeProps) {
  const clamped = value == null ? min : Math.min(max, Math.max(min, value));
  const pct = ((clamped - min) / (max - min)) * 100;
  const displayValue = value == null ? '—' : value.toFixed(precision);

  const inRange = value != null && targetMin != null && targetMax != null && value >= targetMin && value <= targetMax;

  const data = [{ name: label, value: pct, fill: color }];

  return (
    <div className="flex flex-col items-center">
      <div className="relative h-[104px] w-[104px]">
        <RadialBarChart
          width={104}
          height={104}
          cx="50%"
          cy="50%"
          innerRadius="72%"
          outerRadius="100%"
          barSize={8}
          data={data}
          startAngle={90}
          endAngle={-270}
        >
          <PolarAngleAxis type="number" domain={[0, 100]} angleAxisId={0} tick={false} />
          <RadialBar
            background={{ fill: 'var(--color-grid)' }}
            dataKey="value"
            cornerRadius={4}
            isAnimationActive
            animationDuration={400}
          />
        </RadialBarChart>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="tabular-nums text-lg font-semibold text-[var(--color-ink)]">{displayValue}</span>
          <span className="text-[10px] text-[var(--color-ink-muted)]">{unit}</span>
        </div>
      </div>
      <span className="mt-1 text-xs font-medium text-[var(--color-ink-secondary)]">{label}</span>
      {targetMin != null && targetMax != null && (
        <span className={`text-[10px] ${inRange ? 'text-[var(--color-good)]' : 'text-[var(--color-ink-muted)]'}`}>
          {inRange ? 'in range' : `target ${targetMin}–${targetMax}`}
        </span>
      )}
    </div>
  );
}
