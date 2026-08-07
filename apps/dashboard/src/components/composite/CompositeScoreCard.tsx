import { useEffect, useState } from 'react';
import { motion, useMotionValue, useSpring, useTransform } from 'framer-motion';
import { RadialBar, RadialBarChart, PolarAngleAxis } from 'recharts';

function scoreColor(score: number) {
  if (score >= 75) return 'var(--color-good)';
  if (score >= 50) return 'var(--color-warning)';
  return 'var(--color-critical)';
}

export function CompositeScoreCard({ score }: { score: number | null }) {
  const [display, setDisplay] = useState(0);
  const motionValue = useMotionValue(0);
  const spring = useSpring(motionValue, { stiffness: 90, damping: 20 });
  const rounded = useTransform(spring, (v) => Math.round(v));

  useEffect(() => {
    motionValue.set(score ?? 0);
  }, [score, motionValue]);

  useEffect(() => rounded.on('change', setDisplay), [rounded]);

  const value = score ?? 0;
  const color = scoreColor(value);
  const data = [{ value, fill: color }];

  return (
    <div className="flex flex-col items-center justify-center gap-2 py-1">
      <div className="relative h-[152px] w-[152px]">
        <RadialBarChart
          width={152}
          height={152}
          cx="50%"
          cy="50%"
          innerRadius="78%"
          outerRadius="100%"
          barSize={12}
          data={data}
          startAngle={90}
          endAngle={-270}
        >
          <PolarAngleAxis type="number" domain={[0, 100]} angleAxisId={0} tick={false} />
          <RadialBar background={{ fill: 'var(--color-grid)' }} dataKey="value" cornerRadius={6} isAnimationActive={false} />
        </RadialBarChart>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <motion.span className="tabular-nums text-4xl font-bold" style={{ color }}>
            {score == null ? '—' : display}
          </motion.span>
          <span className="text-[11px] text-[var(--color-ink-muted)]">/ 100</span>
        </div>
      </div>
      <p className="text-xs font-medium uppercase tracking-wide text-[var(--color-ink-secondary)]">Composite Score</p>
    </div>
  );
}
