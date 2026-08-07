import { describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Gauge } from './Gauge';

describe('Gauge', () => {
  test('renders the formatted value and unit', () => {
    render(<Gauge label="Articulation Rate" value={4.567} min={0} max={10} unit="syll/s" color="#000" precision={2} />);
    expect(screen.getByText('4.57')).toBeInTheDocument();
    expect(screen.getByText('syll/s')).toBeInTheDocument();
    expect(screen.getByText('Articulation Rate')).toBeInTheDocument();
  });

  test('shows an em dash placeholder when value is null', () => {
    render(<Gauge label="Pitch" value={null} min={0} max={400} unit="Hz" color="#000" />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  test('shows "in range" when the value falls within the target band', () => {
    render(<Gauge label="Rate" value={5} min={0} max={10} unit="x" color="#000" targetMin={4} targetMax={6} />);
    expect(screen.getByText('in range')).toBeInTheDocument();
  });

  test('shows the target band when the value falls outside it', () => {
    render(<Gauge label="Rate" value={9} min={0} max={10} unit="x" color="#000" targetMin={4} targetMax={6} />);
    expect(screen.getByText('target 4–6')).toBeInTheDocument();
  });

  test('renders no target text at all when no target band is given', () => {
    render(<Gauge label="Rate" value={5} min={0} max={10} unit="x" color="#000" />);
    expect(screen.queryByText(/target/)).not.toBeInTheDocument();
    expect(screen.queryByText('in range')).not.toBeInTheDocument();
  });
});
