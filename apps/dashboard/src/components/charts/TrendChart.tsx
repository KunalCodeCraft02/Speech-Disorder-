import { Area, AreaChart, CartesianGrid, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { EmptyState } from '../common/EmptyState';

interface TrendChartProps<T> {
  data: T[];
  dataKey: keyof T & string;
  color: string;
  unit: string;
  domain?: [number | 'auto', number | 'auto'];
  targetBand?: [number, number] | null;
  formatValue?: (v: number) => string;
}

function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString(undefined, { minute: '2-digit', second: '2-digit' });
}

export function TrendChart<T extends { ts: number }>({
  data,
  dataKey,
  color,
  unit,
  domain = ['auto', 'auto'],
  targetBand,
  formatValue,
}: TrendChartProps<T>) {
  if (data.length === 0) {
    return <EmptyState title="Waiting for data" hint="Live metrics will appear here once the session is streaming" />;
  }

  const gradientId = `grad-${dataKey}`;

  return (
    <ResponsiveContainer width="100%" height={160}>
      <AreaChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: -18 }}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.35} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="var(--color-grid)" strokeDasharray="3 3" vertical={false} />
        {targetBand && <ReferenceArea y1={targetBand[0]} y2={targetBand[1]} fill="var(--color-good)" fillOpacity={0.08} strokeOpacity={0} />}
        <XAxis
          dataKey="ts"
          type="number"
          domain={['dataMin', 'dataMax']}
          tickFormatter={formatTime}
          stroke="var(--color-axis)"
          tick={{ fill: 'var(--color-ink-muted)', fontSize: 10 }}
          minTickGap={40}
        />
        <YAxis
          domain={domain}
          stroke="var(--color-axis)"
          tick={{ fill: 'var(--color-ink-muted)', fontSize: 10 }}
          width={38}
        />
        <Tooltip
          contentStyle={{
            background: 'var(--color-surface-raised)',
            border: '1px solid var(--color-border-strong)',
            borderRadius: 8,
            fontSize: 12,
          }}
          labelStyle={{ color: 'var(--color-ink-muted)' }}
          labelFormatter={(ts) => formatTime(ts as number)}
          formatter={(value) => {
            const num = typeof value === 'number' ? value : Number(value);
            return [formatValue ? formatValue(num) : num, unit];
          }}
        />
        <Area
          type="monotone"
          dataKey={dataKey as string}
          stroke={color}
          strokeWidth={2}
          fill={`url(#${gradientId})`}
          isAnimationActive={false}
          connectNulls
          dot={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
