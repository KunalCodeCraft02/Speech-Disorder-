// Single formatting layer for every metric rendered in the UI (Part 20/22
// of the analytics-accuracy pass). Every card/tile/summary stat should
// route through this instead of calling `.toFixed()` directly -- a raw
// `.toFixed()` on NaN silently renders the string "NaN" in the DOM, and
// null/undefined/Infinity are all real states the DSP pipeline can emit
// (no voiced frames this window, zero completed pauses yet, a division
// guarded elsewhere slipping through, etc). Centralizing this in one place
// means every screen treats "no valid reading" the same way instead of
// each component inventing its own blank/dash/NaN convention.

export const NA = 'N/A';

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Formats a metric value for display, or NA if the value is null/undefined/NaN/±Infinity. */
export function formatMetric(value: number | null | undefined, digits = 1, unit = ''): string {
  if (!isFiniteNumber(value)) return NA;
  return `${value.toFixed(digits)}${unit}`;
}

/** Same as formatMetric, but for values that are already integers (session totals, counts) -- no decimal digits, still NA-safe. */
export function formatCount(value: number | null | undefined, unit = ''): string {
  if (!isFiniteNumber(value)) return NA;
  return `${Math.round(value).toLocaleString()}${unit}`;
}

/** Formats a percentage (0-100 already) with NA-safety and an optional clamp, since a display percent should never read below 0% or above 100%. */
export function formatPercent(value: number | null | undefined, digits = 0): string {
  if (!isFiniteNumber(value)) return NA;
  const clamped = Math.min(100, Math.max(0, value));
  return `${clamped.toFixed(digits)}%`;
}

/** Normalizes a raw numeric metric before it's ever stored/emitted -- collapses NaN/±Infinity to null so downstream consumers only ever see "a real number" or "null", never a value that would need per-call sanitizing. */
export function sanitizeMetric(value: number | null | undefined): number | null {
  if (value == null) return null;
  return isFiniteNumber(value) ? value : null;
}
