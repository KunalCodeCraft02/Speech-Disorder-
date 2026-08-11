import { useEffect, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { LiveSessionPage } from './pages/LiveSessionPage';
import { CalibrationPage } from './pages/CalibrationPage';
import { TodayPage } from './pages/TodayPage';
import { AnalyticsPage } from './pages/AnalyticsPage';
import { OnboardingFlow } from './pages/OnboardingFlow';
import { SessionProvider } from './context/SessionContext';
import { getAccount, type AccountRecord } from './storage/account';

// Single-user, single-device app: no server-side accounts, no mode
// selection — just the live session screen, its Analytics tab,
// calibration, and the end-of-day insight view. Gated behind a one-time,
// on-device Terms & Conditions + local login/sign-up (OnboardingFlow) --
// once a device has consented and logged in, it goes straight to the main
// routes on every later launch (no logout flow, matching the rest of the
// app's single-patient-per-device design).
export default function App() {
  const [account, setAccount] = useState<AccountRecord | null>(null); // null = still loading from IndexedDB

  useEffect(() => {
    getAccount().then(setAccount);
  }, []);

  if (account === null) {
    // Briefly shown on cold start while IndexedDB opens -- avoids a flash
    // of the onboarding flow for an already-onboarded device.
    return <div className="h-screen w-full bg-[var(--color-plane)]" />;
  }

  if (!account.consentAcceptedAt || !account.loggedIn) {
    return <OnboardingFlow account={account} onComplete={setAccount} />;
  }

  return (
    <SessionProvider>
      <Routes>
        <Route path="/" element={<LiveSessionPage />} />
        <Route path="/analytics" element={<AnalyticsPage />} />
        <Route path="/calibrate" element={<CalibrationPage />} />
        <Route path="/today" element={<TodayPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </SessionProvider>
  );
}
