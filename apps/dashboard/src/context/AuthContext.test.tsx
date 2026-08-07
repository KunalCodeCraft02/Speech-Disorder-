import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { AuthProvider, useAuth } from './AuthContext';
import { dataClient, tokenStore } from '../lib/dataClient';

function Probe() {
  const { user, status } = useAuth();
  return (
    <div>
      <span data-testid="status">{status}</span>
      <span data-testid="user">{user?.name ?? ''}</span>
    </div>
  );
}

describe('AuthProvider', () => {
  beforeEach(() => {
    tokenStore.clear();
    // Deterministic regardless of the dev .env's VITE_AUTO_LOGIN_* values or
    // whether a gateway happens to be reachable -- this test only cares
    // about the "nothing stored, nothing configured/reachable" path.
    vi.spyOn(dataClient, 'me').mockRejectedValue(new Error('no session'));
    vi.spyOn(dataClient, 'login').mockRejectedValue(new Error('no server'));
  });

  afterEach(() => {
    tokenStore.clear();
    vi.restoreAllMocks();
  });

  test('starts in loading, then settles to unauthenticated with no stored/auto-login session', async () => {
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>
    );

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated'));
    expect(screen.getByTestId('user')).toBeEmptyDOMElement();
  });

  test('login() stores tokens and flips status to authenticated', async () => {
    const fakeUser = { id: 'u1', name: 'Ada', email: 'ada@example.com', role: 'patient' as const, createdAt: '2026-01-01T00:00:00.000Z' };
    // Only the explicit login('ada@example.com', ...) call below should
    // succeed -- the dev .env's VITE_AUTO_LOGIN_* still fires its own
    // dataClient.login() attempt on mount (before the button is clicked),
    // which must keep failing so it doesn't race this test's assertion.
    vi.spyOn(dataClient, 'login').mockImplementation(async (email: string) => {
      if (email !== 'ada@example.com') throw new Error('no server');
      return { user: fakeUser, accessToken: 'a', refreshToken: 'r' };
    });

    function LoginProbe() {
      const { user, status, login } = useAuth();
      return (
        <div>
          <span data-testid="status">{status}</span>
          <span data-testid="user">{user?.name ?? ''}</span>
          <button onClick={() => login('ada@example.com', 'pw')}>login</button>
        </div>
      );
    }

    render(
      <AuthProvider>
        <LoginProbe />
      </AuthProvider>
    );

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated'));
    screen.getByText('login').click();

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('authenticated'));
    expect(screen.getByTestId('user')).toHaveTextContent('Ada');
    expect(tokenStore.getAccess()).toBe('a');
  });
});
