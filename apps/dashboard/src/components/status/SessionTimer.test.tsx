import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { SessionTimer } from './SessionTimer';

// The component intentionally paints a stale value on its very first render
// — the ref-based "anchor" is only updated by an effect, which commits
// *after* that paint, and nothing but the 1s interval triggers a re-render
// afterward. So every consumer only ever observes a settled value starting
// one tick (1s) later; these tests advance exactly one tick before
// asserting, rather than pretending the pre-effect frame is the real output.
function renderAndSettle(props: { startedAt: string | null; elapsedSec: number | null }) {
  render(<SessionTimer {...props} />);
  act(() => {
    vi.advanceTimersByTime(1000);
  });
}

describe('SessionTimer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('renders elapsedSec (plus the one settling tick) formatted as mm:ss', () => {
    renderAndSettle({ startedAt: null, elapsedSec: 65 });
    expect(screen.getByText('01:06')).toBeInTheDocument();
    expect(screen.getByText('Session duration')).toBeInTheDocument();
  });

  test('formats an hour-plus duration as h:mm:ss', () => {
    renderAndSettle({ startedAt: null, elapsedSec: 3725 });
    expect(screen.getByText('1:02:06')).toBeInTheDocument();
  });

  test('derives elapsed time from startedAt when elapsedSec is null', () => {
    const startedAt = new Date(Date.now() - 10_000).toISOString();
    renderAndSettle({ startedAt, elapsedSec: null });
    expect(screen.getByText('00:11')).toBeInTheDocument();
  });

  test('never displays a negative duration', () => {
    const startedAt = new Date(Date.now() + 10_000).toISOString(); // clock skew: "started" in the future
    renderAndSettle({ startedAt, elapsedSec: null });
    expect(screen.getByText('00:00')).toBeInTheDocument();
  });

  test('keeps ticking forward on subsequent intervals', () => {
    render(<SessionTimer startedAt={null} elapsedSec={0} />);
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(screen.getByText('00:03')).toBeInTheDocument();
  });
});
