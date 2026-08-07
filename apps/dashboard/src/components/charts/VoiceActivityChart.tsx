import { TrendChart } from './TrendChart';
import type { SeriesPoint } from '../../hooks/useMergedSeries';

export function VoiceActivityChart({ data }: { data: SeriesPoint[] }) {
  return (
    <TrendChart
      data={data}
      dataKey="voiceActivityPercent"
      color="var(--color-va)"
      unit="%"
      domain={[0, 100]}
      formatValue={(v) => v.toFixed(0)}
    />
  );
}
