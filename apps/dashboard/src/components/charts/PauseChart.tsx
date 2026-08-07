import { TrendChart } from './TrendChart';
import type { SeriesPoint } from '../../hooks/useMergedSeries';

export function PauseChart({ data }: { data: SeriesPoint[] }) {
  return (
    <TrendChart
      data={data}
      dataKey="pauseRatio"
      color="var(--color-pause)"
      unit="ratio"
      domain={[0, 1]}
      formatValue={(v) => v.toFixed(2)}
    />
  );
}
