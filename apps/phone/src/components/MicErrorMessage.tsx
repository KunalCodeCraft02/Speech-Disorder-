/**
 * Renders a describeMicErrorVerbose() string: the human message, plus
 * a small muted diagnostic line (error.name, secure-context state,
 * WebView Chromium build). Splitting it here keeps every mic-error
 * screenshot a self-contained bug report.
 */
export function MicErrorMessage({ message }: { message: string }) {
  const [summary, diagnostics] = message.split('\n');
  return (
    <div className="flex max-w-xs flex-col items-center gap-1 text-center">
      <p className="text-sm text-[var(--color-critical)]">{summary}</p>
      {diagnostics && <p className="text-[10px] text-[var(--color-ink-muted)]">{diagnostics}</p>}
    </div>
  );
}
