import { useState } from 'react';
import clsx from 'clsx';
import { hashPin } from '../lib/pinHash';
import { saveAccount, type AccountRecord } from '../storage/account';

type Mode = 'login' | 'signup';
const PIN_MIN_LENGTH = 4;

/**
 * Local device Login/Sign-Up (see storage/account.ts's doc comment -- this
 * app has no server, so "account" means a single named profile + PIN
 * gating this one device, not a network-authenticated identity). Sign Up
 * creates the profile; Login just re-enters its PIN. Only one profile
 * exists per device, matching the rest of the app's single-patient design,
 * so the tab that doesn't apply yet explains why instead of rendering a
 * form that couldn't do anything.
 */
export function AuthPage({ account, onAuthenticated }: { account: AccountRecord; onAuthenticated: (updated: AccountRecord) => void }) {
  const hasProfile = account.profileName != null && account.pinHash != null;
  const [mode, setMode] = useState<Mode>(hasProfile ? 'login' : 'signup');
  const [name, setName] = useState('');
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSignUp() {
    setError(null);
    if (name.trim().length === 0) return setError('Please enter your name.');
    if (pin.length < PIN_MIN_LENGTH || !/^\d+$/.test(pin)) return setError(`PIN must be at least ${PIN_MIN_LENGTH} digits.`);
    if (pin !== confirmPin) return setError('PINs do not match.');

    setBusy(true);
    try {
      const pinHash = await hashPin(pin);
      const updated: AccountRecord = { ...account, profileName: name.trim(), pinHash, loggedIn: true };
      await saveAccount(updated);
      onAuthenticated(updated);
    } finally {
      setBusy(false);
    }
  }

  async function handleLogin() {
    setError(null);
    if (pin.length === 0) return setError('Please enter your PIN.');

    setBusy(true);
    try {
      const pinHash = await hashPin(pin);
      if (pinHash !== account.pinHash) {
        setError('Incorrect PIN.');
        return;
      }
      const updated: AccountRecord = { ...account, loggedIn: true };
      await saveAccount(updated);
      onAuthenticated(updated);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="mx-auto flex h-screen w-full max-w-md flex-col justify-center overflow-y-auto px-5"
      style={{ paddingTop: 'max(1.5rem, env(safe-area-inset-top))', paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
    >
      <div className="flex flex-col items-center gap-2 pb-6">
        <img src="/icons/icon-192.png" alt="Speech Biofeedback" className="h-16 w-16 rounded-2xl shadow-[0_8px_32px_-8px_rgba(91,82,232,0.5)]" />
        <h1 className="text-lg font-bold text-[var(--color-ink)]">Speech Biofeedback</h1>
      </div>

      <div className="glass-surface rounded-2xl p-4">
        <div className="glass-surface-raised mb-4 flex rounded-xl p-1">
          {(['login', 'signup'] as Mode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => {
                setMode(m);
                setError(null);
              }}
              className={clsx(
                'flex-1 rounded-lg py-2 text-sm font-semibold transition-colors',
                mode === m ? 'bg-[var(--color-accent)] text-white' : 'text-[var(--color-ink-secondary)]'
              )}
            >
              {m === 'login' ? 'Login' : 'Sign Up'}
            </button>
          ))}
        </div>

        {mode === 'signup' && hasProfile && (
          <p className="mb-3 text-center text-xs text-[var(--color-warning)]">
            A profile already exists on this device ({account.profileName}). Switch to Login instead.
          </p>
        )}

        {mode === 'login' && !hasProfile && (
          <p className="mb-3 text-center text-xs text-[var(--color-warning)]">No profile on this device yet — switch to Sign Up to create one.</p>
        )}

        {mode === 'signup' && !hasProfile && (
          <div className="flex flex-col gap-3">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
              autoComplete="name"
              className="glass-surface-raised rounded-xl px-4 py-3 text-sm text-[var(--color-ink)] placeholder:text-[var(--color-ink-muted)] focus:outline-none"
            />
            <input
              type="password"
              inputMode="numeric"
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
              placeholder={`Create a PIN (min ${PIN_MIN_LENGTH} digits)`}
              className="glass-surface-raised rounded-xl px-4 py-3 text-sm text-[var(--color-ink)] placeholder:text-[var(--color-ink-muted)] focus:outline-none"
            />
            <input
              type="password"
              inputMode="numeric"
              value={confirmPin}
              onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, ''))}
              placeholder="Confirm PIN"
              className="glass-surface-raised rounded-xl px-4 py-3 text-sm text-[var(--color-ink)] placeholder:text-[var(--color-ink-muted)] focus:outline-none"
            />
            {error && <p className="text-center text-xs text-[var(--color-critical)]">{error}</p>}
            <button
              type="button"
              onClick={() => void handleSignUp()}
              disabled={busy}
              className="glass-btn glass-btn-accent mt-1 w-full rounded-xl py-3 text-base font-bold text-white transition-all active:scale-[0.98] disabled:opacity-60"
            >
              {busy ? 'Creating…' : 'Sign Up'}
            </button>
          </div>
        )}

        {mode === 'login' && hasProfile && (
          <div className="flex flex-col gap-3">
            <p className="text-center text-sm text-[var(--color-ink-secondary)]">
              Welcome back, <span className="font-semibold text-[var(--color-ink)]">{account.profileName}</span>
            </p>
            <input
              type="password"
              inputMode="numeric"
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
              placeholder="Enter your PIN"
              autoFocus
              className="glass-surface-raised rounded-xl px-4 py-3 text-center text-sm tracking-[0.3em] text-[var(--color-ink)] placeholder:tracking-normal placeholder:text-[var(--color-ink-muted)] focus:outline-none"
            />
            {error && <p className="text-center text-xs text-[var(--color-critical)]">{error}</p>}
            <button
              type="button"
              onClick={() => void handleLogin()}
              disabled={busy}
              className="glass-btn glass-btn-accent mt-1 w-full rounded-xl py-3 text-base font-bold text-white transition-all active:scale-[0.98] disabled:opacity-60"
            >
              {busy ? 'Logging in…' : 'Log In'}
            </button>
          </div>
        )}
      </div>

      <p className="mt-4 text-center text-[11px] text-[var(--color-ink-muted)]">Your profile and PIN stay on this device only.</p>
    </div>
  );
}
