import { TrendChart } from './TrendChart';
import type { SeriesPoint } from '../../hooks/useMergedSeries';

export function PitchChart({ data }: { data: SeriesPoint[] }) {
  return (
    <TrendChart
      data={data}
      dataKey="meanPitchHz"
      color="var(--color-pitch)"
      unit="Hz"
      domain={[60, 320]}
      formatValue={(v) => v.toFixed(0)}
    />
  );
}
