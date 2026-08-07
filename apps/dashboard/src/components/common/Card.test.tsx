import { describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Card } from './Card';

describe('Card', () => {
  test('renders children', () => {
    render(<Card>Hello content</Card>);
    expect(screen.getByText('Hello content')).toBeInTheDocument();
  });

  test('renders a title and subtitle when given', () => {
    render(
      <Card title="Session History" subtitle="Last 30 days">
        body
      </Card>
    );
    expect(screen.getByText('Session History')).toBeInTheDocument();
    expect(screen.getByText('Last 30 days')).toBeInTheDocument();
  });

  test('omits the header entirely when there is no title or actions', () => {
    const { container } = render(<Card>body only</Card>);
    expect(container.querySelector('header')).not.toBeInTheDocument();
  });

  test('renders a header for actions alone, even without a title', () => {
    render(<Card actions={<button type="button">Do thing</button>}>body</Card>);
    expect(screen.getByRole('button', { name: 'Do thing' })).toBeInTheDocument();
  });

  test('applies the padded body class by default and omits it when padded=false', () => {
    const { container: paddedContainer } = render(<Card>body</Card>);
    expect(paddedContainer.querySelector('div.p-4')).not.toBeNull();

    const { container: unpaddedContainer } = render(<Card padded={false}>body</Card>);
    expect(unpaddedContainer.querySelector('div.p-4')).toBeNull();
  });
});
