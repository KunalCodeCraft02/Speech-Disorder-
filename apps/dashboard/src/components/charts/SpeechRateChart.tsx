import { TrendChart } from './TrendChart';
import type { SeriesPoint } from '../../hooks/useMergedSeries';
import type { CalibrationProfile } from '../../types';

export function SpeechRateChart({ data, calibration }: { data: SeriesPoint[]; calibration?: CalibrationProfile }) {
  const band =
    calibration?.bradylaliaThreshold != null && calibration?.tachylaliaThreshold != null
      ? ([calibration.bradylaliaThreshold, calibration.tachylaliaThreshold] as [number, number])
      : null;

  return (
    <TrendChart
      data={data}
      dataKey="articulationRateSPS"
      color="var(--color-rate)"
      unit="syll/s"
      domain={[0, 8]}
      targetBand={band}
      formatValue={(v) => v.toFixed(2)}
    />
  );
}
