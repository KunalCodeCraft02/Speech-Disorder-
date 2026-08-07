import { useEffect, useRef, useState } from 'react';

function formatDuration(totalSeconds: number) {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.floor(totalSeconds % 60);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/**
 * Ticks locally every second rather than only re-rendering when a metrics
 * frame arrives, so the timer stays smooth even if the stream stutters —
 * each new `elapsedSec` just re-anchors the clock, so it never drifts from
 * the DSP's own elapsed-time accounting.
 */
export function SessionTimer({ startedAt, elapsedSec }: { startedAt: string | null; elapsedSec: number | null }) {
  const anchor = useRef({ elapsed: 0, wallClock: Date.now() });
  const [, forceTick] = useState(0);

  // Re-anchor only when the upstream elapsed value actually changes —
  // not on every 1s tick render, which would otherwise keep resetting
  // wallClock and freeze the display between frames.
  useEffect(() => {
    if (elapsedSec != null) {
      anchor.current = { elapsed: elapsedSec, wallClock: Date.now() };
    } else if (startedAt) {
      anchor.current = { elapsed: (Date.now() - new Date(startedAt).getTime()) / 1000, wallClock: Date.now() };
    }
  }, [elapsedSec, startedAt]);

  useEffect(() => {
    const id = setInterval(() => forceTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const seconds = anchor.current.elapsed + (Date.now() - anchor.current.wallClock) / 1000;

  return (
    <div className="flex flex-col items-center gap-1">
      <span className="tabular-nums text-3xl font-semibold text-[var(--color-ink)]">
        {formatDuration(Math.max(0, seconds))}
      </span>
      <span className="text-xs uppercase tracking-wide text-[var(--color-ink-muted)]">Session duration</span>
    </div>
  );
}
