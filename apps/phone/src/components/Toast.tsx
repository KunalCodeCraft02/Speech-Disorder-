/** Generic bottom-anchored toast — used for the pitch/tone prosody cue (Part E.13). */
export function Toast({ message, onDismiss }: { message: string | null; onDismiss: () => void }) {
  if (!message) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-28 z-50 flex justify-center px-5">
      <button
        type="button"
        onClick={onDismiss}
        className="glass-surface pointer-events-auto rounded-full px-4 py-2.5 text-sm font-medium text-[var(--color-ink)]"
      >
        {message}
      </button>
    </div>
  );
}
