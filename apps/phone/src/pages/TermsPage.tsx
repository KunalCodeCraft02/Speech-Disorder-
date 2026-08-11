import { useState } from 'react';

interface Consent {
  recording: boolean;
  onDeviceOnly: boolean;
  terms: boolean;
}

const CONSENT_ITEMS: Array<{ key: keyof Consent; text: string }> = [
  {
    key: 'recording',
    text: 'I consent to this app recording and analyzing my voice through my device’s microphone while a session is running.',
  },
  {
    key: 'onDeviceOnly',
    text: 'I understand all speech analysis (rate, pitch, pauses, and related metrics) happens entirely on this device, and no audio or data is sent to any server.',
  },
  {
    key: 'terms',
    text: 'I have read and agree to the Terms & Conditions, and understand this app is a personal speech-monitoring tool, not a medical diagnostic device.',
  },
];

/**
 * First-run consent gate (shown once per device -- see storage/account.ts).
 * Continue stays disabled until every required box is checked; the parent
 * (OnboardingFlow) owns persisting consent and the swipe transition into
 * AuthPage.
 */
export function TermsPage({ onContinue }: { onContinue: () => void }) {
  const [consent, setConsent] = useState<Consent>({ recording: false, onDeviceOnly: false, terms: false });
  const allChecked = consent.recording && consent.onDeviceOnly && consent.terms;

  return (
    <div
      className="mx-auto flex h-screen w-full max-w-md flex-col overflow-hidden px-5"
      style={{ paddingTop: 'max(1.5rem, env(safe-area-inset-top))', paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
    >
      <div className="flex shrink-0 flex-col items-center gap-3 pb-4 pt-2">
        <img src="/icons/icon-192.png" alt="Speech Biofeedback" className="h-20 w-20 rounded-2xl shadow-[0_8px_32px_-8px_rgba(91,82,232,0.5)]" />
        <h1 className="text-xl font-bold text-[var(--color-ink)]">Terms &amp; Conditions</h1>
      </div>

      <div className="glass-surface min-h-0 flex-1 overflow-y-auto rounded-2xl p-4">
        <p className="mb-4 text-xs leading-relaxed text-[var(--color-ink-secondary)]">
          Before you start, please review and accept the following to use Speech Biofeedback:
        </p>
        <div className="flex flex-col gap-3">
          {CONSENT_ITEMS.map((item) => (
            <label key={item.key} className="glass-surface-raised flex cursor-pointer items-start gap-3 rounded-xl p-3 active:opacity-80">
              <input
                type="checkbox"
                checked={consent[item.key]}
                onChange={(e) => setConsent((c) => ({ ...c, [item.key]: e.target.checked }))}
                className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--color-accent)]"
              />
              <span className="text-sm leading-relaxed text-[var(--color-ink)]">{item.text}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="shrink-0 pt-4">
        <button
          type="button"
          onClick={onContinue}
          disabled={!allChecked}
          className={
            allChecked
              ? 'glass-btn glass-btn-accent w-full rounded-2xl py-4 text-lg font-bold text-white transition-all active:scale-[0.98]'
              : 'glass-btn glass-btn-disabled w-full rounded-2xl py-4 text-lg font-bold transition-all'
          }
        >
          Continue
        </button>
      </div>
    </div>
  );
}
