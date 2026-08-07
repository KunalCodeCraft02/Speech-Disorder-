import { useState, type FormEvent } from 'react';
import { useAuth } from '../context/AuthContext';
import type { Role } from '../types';

/**
 * Patient sign-in for the phone app. On success AuthContext flips to
 * 'authenticated' and App.tsx routes into ModeSelectPage -- there's no
 * separate redirect step.
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
    <div className="flex min-h-screen flex-col justify-center bg-[var(--color-plane)] px-5 py-6">
      <div className="mb-6">
        <h1 className="text-base font-semibold text-[var(--color-ink)]">Speech Biofeedback</h1>
        <p className="mt-1 text-xs text-[var(--color-ink-muted)]">
          {mode === 'login' ? 'Sign in to start a session' : 'Create an account'}
        </p>
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
              className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2.5 text-sm text-[var(--color-ink)] outline-none focus:border-[var(--color-critical)]"
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
            className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2.5 text-sm text-[var(--color-ink)] outline-none focus:border-[var(--color-critical)]"
            autoComplete="email"
            inputMode="email"
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
            className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2.5 text-sm text-[var(--color-ink)] outline-none focus:border-[var(--color-critical)]"
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          />
        </label>

        {mode === 'register' && (
          <label className="flex flex-col gap-1 text-xs font-medium text-[var(--color-ink-secondary)]">
            Role
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as Role)}
              className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2.5 text-sm text-[var(--color-ink)] outline-none focus:border-[var(--color-critical)]"
            >
              <option value="patient">Patient</option>
              <option value="clinician">Clinician</option>
            </select>
          </label>
        )}

        {error && (
          <p className="rounded-lg border border-[var(--color-critical)]/40 bg-[var(--color-critical)]/10 px-3 py-2 text-xs text-[var(--color-critical)]">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="mt-1 inline-flex items-center justify-center rounded-lg bg-[var(--color-critical)] px-4 py-2.5 text-sm font-semibold text-white transition-opacity active:opacity-80 disabled:opacity-60"
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
        className="mt-4 text-center text-xs font-medium text-[var(--color-ink-muted)]"
      >
        {mode === 'login' ? "Don't have an account? Create one" : 'Already have an account? Sign in'}
      </button>
    </div>
  );
}
