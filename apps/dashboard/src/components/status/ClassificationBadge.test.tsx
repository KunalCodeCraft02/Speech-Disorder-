import { describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ClassificationBadge } from './ClassificationBadge';

describe('ClassificationBadge', () => {
  test('renders the normal state label and description', () => {
    render(<ClassificationBadge classification="normal" confidence={0.91} />);
    expect(screen.getByText('Normal')).toBeInTheDocument();
    expect(screen.getByText(/within calibrated range/)).toBeInTheDocument();
    expect(screen.getByText('91%')).toBeInTheDocument();
  });

  test('renders the tachylalia state', () => {
    render(<ClassificationBadge classification="tachylalia" confidence={0.8} />);
    expect(screen.getByText('Tachylalia')).toBeInTheDocument();
    expect(screen.getByText(/too fast/)).toBeInTheDocument();
  });

  test('renders the bradylalia state', () => {
    render(<ClassificationBadge classification="bradylalia" confidence={0.6} />);
    expect(screen.getByText('Bradylalia')).toBeInTheDocument();
    expect(screen.getByText(/too slow/)).toBeInTheDocument();
  });

  test('renders the uncalibrated state', () => {
    render(<ClassificationBadge classification="uncalibrated" confidence={0} />);
    expect(screen.getByText('Uncalibrated')).toBeInTheDocument();
    expect(screen.getByText(/Run calibration/)).toBeInTheDocument();
  });

  test('shows a placeholder when there is no classification yet', () => {
    render(<ClassificationBadge classification={null} confidence={null} />);
    expect(screen.getByText('Awaiting data')).toBeInTheDocument();
    expect(screen.getByText('No live classification yet')).toBeInTheDocument();
  });

  test('omits the confidence row when confidence is null', () => {
    render(<ClassificationBadge classification="normal" confidence={null} />);
    expect(screen.queryByText('Confidence')).not.toBeInTheDocument();
  });

  test('rounds confidence to the nearest percent', () => {
    render(<ClassificationBadge classification="normal" confidence={0.876} />);
    expect(screen.getByText('88%')).toBeInTheDocument();
  });
});
