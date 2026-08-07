import { describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ConnectionBadge } from './ConnectionBadge';

describe('ConnectionBadge', () => {
  test('shows "Live" for the connected state', () => {
    render(<ConnectionBadge state="connected" />);
    expect(screen.getByText('Live')).toBeInTheDocument();
  });

  test('shows "Connecting…" for the connecting state', () => {
    render(<ConnectionBadge state="connecting" />);
    expect(screen.getByText('Connecting…')).toBeInTheDocument();
  });

  test('shows "Disconnected" for the disconnected state', () => {
    render(<ConnectionBadge state="disconnected" />);
    expect(screen.getByText('Disconnected')).toBeInTheDocument();
  });

  test('shows "Connection error" for the error state', () => {
    render(<ConnectionBadge state="error" />);
    expect(screen.getByText('Connection error')).toBeInTheDocument();
  });
});
