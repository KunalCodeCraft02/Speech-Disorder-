import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { hashPin } from '../lib/pinHash';
import { saveDeviceState, type DeviceState } from '../storage/device';
import { createUser, findUserByName, listUsers } from '../storage/users';

type Mode = 'login' | 'signup';
const PIN_MIN_LENGTH = 4;

/**
 * Local device Login/Sign-Up (see storage/users.ts's doc comment -- this
 * app has no server, so an "account" is a named local profile + PIN, not a
 * network-authenticated identity). Multiple profiles can exist on one
 * device -- Sign Up always creates a new one; Login looks an existing one
 * up by name and checks its PIN, so a device with several profiles (e.g. a
 * shared tablet) can switch between them via logout -> Login.
 */
export function AuthPage({ device, onAuthenticated }: { device: DeviceState; onAuthenticated: (updated: DeviceState) => void }) {
  const [hasAnyUser, setHasAnyUser] = useState<boolean | null>(null); // null = still checking
  const [mode, setMode] = useState<Mode>('login');
  const [name, setName] = useState('');
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    listUsers().then((users) => {
      setHasAnyUser(users.length > 0);
      setMode(users.length > 0 ? 'login' : 'signup');
    });
  }, []);

  async function handleSignUp() {
    setError(null);
    if (name.trim().length === 0) return setError('Please enter your name.');
    if (pin.length < PIN_MIN_LENGTH || !/^\d+$/.test(pin)) return setError(`PIN must be at least ${PIN_MIN_LENGTH} digits.`);
    if (pin !== confirmPin) return setError('PINs do not match.');

    setBusy(true);
    try {
      if (await findUserByName(name)) {
        setError('That name is already used on this device. Try Login, or pick a different name.');
        return;
      }
      const pinHash = await hashPin(pin);
      const user = await createUser(name, pinHash);
      const updated: DeviceState = { ...device, currentUserId: user.id };
      await saveDeviceState(updated);
      onAuthenticated(updated);
    } finally {
      setBusy(false);
    }
  }

  async function handleLogin() {
    setError(null);
    if (name.trim().length === 0) return setError('Please enter your name.');
    if (pin.length === 0) return setError('Please enter your PIN.');

    setBusy(true);
    try {
      const user = await findUserByName(name);
      if (!user) {
        setError('No profile with that name on this device. Try Sign Up instead.');
        return;
      }
      const pinHash = await hashPin(pin);
      if (pinHash !== user.pinHash) {
        setError('Incorrect PIN.');
        return;
      }
      const updated: DeviceState = { ...device, currentUserId: user.id };
      await saveDeviceState(updated);
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

        {hasAnyUser === false && mode === 'login' && (
          <p className="mb-3 text-center text-xs text-[var(--color-warning)]">No profiles on this device yet — switch to Sign Up to create one.</p>
        )}

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
            placeholder={mode === 'signup' ? `Create a PIN (min ${PIN_MIN_LENGTH} digits)` : 'Enter your PIN'}
            className="glass-surface-raised rounded-xl px-4 py-3 text-sm text-[var(--color-ink)] placeholder:text-[var(--color-ink-muted)] focus:outline-none"
          />
          {mode === 'signup' && (
            <input
              type="password"
              inputMode="numeric"
              value={confirmPin}
              onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, ''))}
              placeholder="Confirm PIN"
              className="glass-surface-raised rounded-xl px-4 py-3 text-sm text-[var(--color-ink)] placeholder:text-[var(--color-ink-muted)] focus:outline-none"
            />
          )}
          {error && <p className="text-center text-xs text-[var(--color-critical)]">{error}</p>}
          <button
            type="button"
            onClick={() => void (mode === 'signup' ? handleSignUp() : handleLogin())}
            disabled={busy || hasAnyUser === null}
            className="glass-btn glass-btn-accent mt-1 w-full rounded-xl py-3 text-base font-bold text-white transition-all active:scale-[0.98] disabled:opacity-60"
          >
            {mode === 'signup' ? (busy ? 'Creating…' : 'Sign Up') : busy ? 'Logging in…' : 'Log In'}
          </button>
        </div>
      </div>

      <p className="mt-4 text-center text-[11px] text-[var(--color-ink-muted)]">Your profile, PIN, and calibration stay on this device only.</p>
    </div>
  );
}
