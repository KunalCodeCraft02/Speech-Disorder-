import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useDisorderMode } from '../lib/disorderMode';
import type { DisorderMode } from '../types';

const CARDS: Array<{ mode: DisorderMode; title: string; description: string; accent: string }> = [
  {
    mode: 'tachylalia',
    title: 'Tachylalia',
    description: 'Monitor and get feedback when your speech rate runs too fast.',
    accent: 'var(--color-critical)',
  },
  {
    mode: 'bradylalia',
    title: 'Bradylalia',
    description: 'Monitor and get feedback when your speech rate runs too slow.',
    accent: 'var(--color-warning)',
  },
];

/**
 * Part D: the first screen a patient sees, before Live Session. Selecting
 * a card sets disorderMode for the whole session (Part B.8 scopes the
 * classifier to that single direction) and routes into Live Session.
 */
export function ModeSelectPage() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { selectDisorderMode } = useDisorderMode();

  function handleSelect(mode: DisorderMode) {
    selectDisorderMode(mode);
    navigate('/session');
  }

  return (
    <div className="flex min-h-screen flex-col bg-[var(--color-plane)] px-5 py-6">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-base font-semibold text-[var(--color-ink)]">Speech Biofeedback</h1>
          {user && <p className="text-xs text-[var(--color-ink-muted)]">Signed in as {user.name}</p>}
        </div>
        <button
          type="button"
          onClick={logout}
          className="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-xs font-medium text-[var(--color-ink-secondary)]"
        >
          Log out
        </button>
      </header>

      <p className="mb-4 text-sm text-[var(--color-ink-secondary)]">Choose what this session monitors:</p>

      <div className="flex flex-1 flex-col gap-4">
        {CARDS.map((card) => (
          <button
            key={card.mode}
            type="button"
            onClick={() => handleSelect(card.mode)}
            className="flex flex-col gap-3 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 text-left shadow-lg shadow-black/10 transition-transform active:scale-[0.98]"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-[var(--color-ink)]">{card.title}</h2>
              <span className="h-3 w-3 rounded-full" style={{ backgroundColor: card.accent }} />
            </div>
            <p className="text-sm text-[var(--color-ink-secondary)]">{card.description}</p>
            <span
              className="mt-1 inline-flex w-fit items-center rounded-lg px-4 py-2 text-sm font-semibold text-white"
              style={{ backgroundColor: card.accent }}
            >
              Select
            </span>
          </button>
        ))}
      </div>

      <p className="mt-4 text-center text-xs text-[var(--color-ink-muted)]">
        You can switch modes any time between sessions from the Live Session screen.
      </p>
    </div>
  );
}
