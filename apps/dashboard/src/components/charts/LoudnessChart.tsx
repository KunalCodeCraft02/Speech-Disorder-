import { TrendChart } from './TrendChart';
import type { SeriesPoint } from '../../hooks/useMergedSeries';

export function LoudnessChart({ data }: { data: SeriesPoint[] }) {
  return (
    <TrendChart
      data={data}
      dataKey="loudnessDb"
      color="var(--color-loudness)"
      unit="dB"
      domain={[-45, 0]}
      formatValue={(v) => v.toFixed(1)}
    />
  );
}
