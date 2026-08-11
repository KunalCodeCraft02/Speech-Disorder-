import { useState } from 'react';
import { TermsPage } from './TermsPage';
import { AuthPage } from './AuthPage';
import { saveAccount, type AccountRecord } from '../storage/account';

type Step = 'terms' | 'auth';

/**
 * First-run flow: Terms & Conditions -> (swipe) -> Login/Sign-Up. Both
 * panels are laid out side by side in a double-width strip and the whole
 * strip is translated with a CSS transition -- a plain transform/opacity
 * animation, no extra dependency -- so the step change reads as one
 * continuous swipe instead of an instant page replace.
 *
 * A returning device that already accepted consent (but isn't logged in --
 * e.g. app data was cleared) starts straight on the `auth` step with no
 * animation, since the swipe is specifically the Terms->Auth transition,
 * not a general step indicator.
 */
export function OnboardingFlow({ account, onComplete }: { account: AccountRecord; onComplete: (updated: AccountRecord) => void }) {
  const [step, setStep] = useState<Step>(account.consentAcceptedAt ? 'auth' : 'terms');
  const [localAccount, setLocalAccount] = useState(account);

  async function handleContinue() {
    const updated: AccountRecord = { ...localAccount, consentAcceptedAt: new Date().toISOString() };
    await saveAccount(updated);
    setLocalAccount(updated);
    setStep('auth');
  }

  return (
    <div className="relative h-screen w-full overflow-hidden bg-[var(--color-plane)]">
      <div
        className="flex h-full w-[200%] transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]"
        style={{ transform: step === 'terms' ? 'translateX(0%)' : 'translateX(-50%)' }}
      >
        <div className="h-full w-1/2 shrink-0">
          <TermsPage onContinue={() => void handleContinue()} />
        </div>
        <div className="h-full w-1/2 shrink-0">
          <AuthPage account={localAccount} onAuthenticated={onComplete} />
        </div>
      </div>
    </div>
  );
}
