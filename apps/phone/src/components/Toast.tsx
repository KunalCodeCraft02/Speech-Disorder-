/** Generic bottom-anchored toast — used for the pitch/tone prosody cue (Part E.13) and the loudness cue (Part G). `bottomClassName` lets two toasts stack without overlapping if both happen to be active at once. */
export function Toast({ message, onDismiss, bottomClassName = 'bottom-28' }: { message: string | null; onDismiss: () => void; bottomClassName?: string }) {
  if (!message) return null;

  return (
    <div className={`pointer-events-none fixed inset-x-0 ${bottomClassName} z-50 flex justify-center px-5`}>
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
