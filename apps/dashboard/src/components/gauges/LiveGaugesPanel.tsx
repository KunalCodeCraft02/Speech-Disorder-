import { Gauge } from './Gauge';
import type { CalibrationProfile, MetricsFrame } from '../../types';

export function LiveGaugesPanel({ frame, calibration }: { frame: MetricsFrame | null; calibration: CalibrationProfile | undefined }) {
  const rateTarget =
    calibration?.bradylaliaThreshold != null && calibration?.tachylaliaThreshold != null
      ? { targetMin: calibration.bradylaliaThreshold, targetMax: calibration.tachylaliaThreshold }
      : {};

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
      <Gauge
        label="Articulation Rate"
        value={frame?.articulationRateSPS ?? null}
        min={0}
        max={8}
        unit="syll/s"
        color="var(--color-rate)"
        precision={2}
        {...rateTarget}
      />
      <Gauge
        label="Mean Pitch"
        value={frame?.meanPitchHz ?? null}
        min={60}
        max={320}
        unit="Hz"
        color="var(--color-pitch)"
        precision={0}
      />
      <Gauge
        label="Loudness"
        value={frame?.loudnessDb ?? null}
        min={-45}
        max={0}
        unit="dB"
        color="var(--color-loudness)"
        precision={1}
      />
      <Gauge
        label="Voice Activity"
        value={frame?.voiceActivityPercent ?? null}
        min={0}
        max={100}
        unit="%"
        color="var(--color-va)"
        precision={0}
      />
    </div>
  );
}
