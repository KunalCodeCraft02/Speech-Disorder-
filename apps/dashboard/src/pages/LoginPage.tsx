import { useState, type FormEvent } from 'react';
import { useAuth } from '../context/AuthContext';
import type { Role } from '../types';

/**
 * Clinician/patient sign-in for the dashboard. On success AuthContext flips
 * to 'authenticated' and App.tsx swaps this out for the dashboard itself --
 * there's no separate redirect step.
 */
export function LoginPage() {
  const { login, register } = useAuth();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<Role>('patient');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      if (mode === 'login') {
        await login(email, password);
      } else {
        await register(name, email, password, role);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--color-plane)] px-4">
      <div className="w-full max-w-sm rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-[0_1px_0_rgba(255,255,255,0.03)_inset]">
        <div className="mb-6 flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-[var(--color-rate)] text-xs font-bold text-white">
            SB
          </div>
          <div>
            <h1 className="text-sm font-semibold text-[var(--color-ink)]">Speech Biofeedback Dashboard</h1>
            <p className="text-xs text-[var(--color-ink-muted)]">
              {mode === 'login' ? 'Sign in to view your sessions' : 'Create an account'}
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          {mode === 'register' && (
            <label className="flex flex-col gap-1 text-xs font-medium text-[var(--color-ink-secondary)]">
              Name
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="rounded-md border border-[var(--color-border)] bg-[var(--color-plane)] px-3 py-2 text-sm text-[var(--color-ink)] outline-none focus:border-[var(--color-rate)]"
                autoComplete="name"
              />
            </label>
          )}

          <label className="flex flex-col gap-1 text-xs font-medium text-[var(--color-ink-secondary)]">
            Email
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="rounded-md border border-[var(--color-border)] bg-[var(--color-plane)] px-3 py-2 text-sm text-[var(--color-ink)] outline-none focus:border-[var(--color-rate)]"
              autoComplete="email"
            />
          </label>

          <label className="flex flex-col gap-1 text-xs font-medium text-[var(--color-ink-secondary)]">
            Password
            <input
              type="password"
              required
              minLength={mode === 'register' ? 8 : undefined}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="rounded-md border border-[var(--color-border)] bg-[var(--color-plane)] px-3 py-2 text-sm text-[var(--color-ink)] outline-none focus:border-[var(--color-rate)]"
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            />
          </label>

          {mode === 'register' && (
            <label className="flex flex-col gap-1 text-xs font-medium text-[var(--color-ink-secondary)]">
              Role
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as Role)}
                className="rounded-md border border-[var(--color-border)] bg-[var(--color-plane)] px-3 py-2 text-sm text-[var(--color-ink)] outline-none focus:border-[var(--color-rate)]"
              >
                <option value="patient">Patient</option>
                <option value="clinician">Clinician</option>
              </select>
            </label>
          )}

          {error && (
            <p className="rounded-md border border-[var(--color-critical)]/40 bg-[var(--color-critical)]/10 px-3 py-2 text-xs text-[var(--color-critical)]">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="mt-1 inline-flex items-center justify-center rounded-md bg-[var(--color-rate)] px-3 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            {submitting ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}
          </button>
        </form>

        <button
          type="button"
          onClick={() => {
            setError(null);
            setMode((m) => (m === 'login' ? 'register' : 'login'));
          }}
          className="mt-4 w-full text-center text-xs font-medium text-[var(--color-ink-muted)] hover:text-[var(--color-ink-secondary)]"
        >
          {mode === 'login' ? "Don't have an account? Create one" : 'Already have an account? Sign in'}
        </button>
      </div>
    </div>
  );
}
