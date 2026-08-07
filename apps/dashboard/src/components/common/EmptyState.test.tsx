import { describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EmptyState } from './EmptyState';

describe('EmptyState', () => {
  test('renders the title', () => {
    render(<EmptyState title="No sessions yet" />);
    expect(screen.getByText('No sessions yet')).toBeInTheDocument();
  });

  test('renders the hint when given', () => {
    render(<EmptyState title="No sessions yet" hint="Completed sessions will appear here" />);
    expect(screen.getByText('Completed sessions will appear here')).toBeInTheDocument();
  });

  test('omits the hint element when not given', () => {
    render(<EmptyState title="No sessions yet" />);
    expect(screen.queryByText('Completed sessions will appear here')).not.toBeInTheDocument();
  });
});
