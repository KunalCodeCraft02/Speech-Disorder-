/**
 * Persistent full-screen block (Part J) shown whenever no microphone-capable
 * headset (Bluetooth earbuds, a wired headset, or a USB headset) is
 * connected -- replaces the app's routes entirely rather than just a
 * banner, since the requirement is "block all functionality," not "warn
 * and let them through."
 */
export function HeadsetGatePrompt({ checking, onRecheck }: { checking: boolean; onRecheck: () => void }) {
  return (
    <div
      className="mx-auto flex h-screen w-full max-w-md flex-col items-center justify-center gap-5 bg-[var(--color-plane)] px-6 text-center"
      style={{ paddingTop: 'max(1rem, env(safe-area-inset-top))', paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
    >
      <div className="glass-surface-raised flex h-16 w-16 items-center justify-center rounded-full text-3xl" aria-hidden="true">
        🎧
      </div>
      <h1 className="text-lg font-semibold text-[var(--color-ink)]">Connect Your Headphones</h1>
      <p className="max-w-xs text-sm text-[var(--color-ink-secondary)]">
        Speech Biofeedback requires a connected microphone headset to record and monitor your speech. Connect your Bluetooth earbuds, a wired
        headset, or a USB headset, then check again.
      </p>
      <button
        type="button"
        onClick={onRecheck}
        disabled={checking}
        className="glass-btn glass-btn-accent w-full max-w-xs rounded-2xl py-4 text-base font-bold text-white active:scale-[0.98] disabled:opacity-60"
      >
        {checking ? 'Checking…' : 'Check Again'}
      </button>
    </div>
  );
}
