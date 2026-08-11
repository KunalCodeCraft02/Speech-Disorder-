import { useCallback, useEffect, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { LiveSessionPage } from './pages/LiveSessionPage';
import { CalibrationPage } from './pages/CalibrationPage';
import { TodayPage } from './pages/TodayPage';
import { AnalyticsPage } from './pages/AnalyticsPage';
import { OnboardingFlow } from './pages/OnboardingFlow';
import { SessionProvider } from './context/SessionContext';
import { CurrentUserProvider } from './context/CurrentUserContext';
import { getDeviceState, saveDeviceState, type DeviceState } from './storage/device';

// Multiple local profiles can exist on one device (see storage/users.ts),
// each with their own calibration -- but at most one is signed in at a
// time. Gated behind a one-time, device-wide Terms & Conditions + local
// login/sign-up (OnboardingFlow); once a device has consented and a
// profile is signed in, it goes straight to the main routes on every later
// launch until that profile logs out.
export default function App() {
  const [device, setDevice] = useState<DeviceState | null>(null); // null = still loading from IndexedDB

  useEffect(() => {
    getDeviceState().then(setDevice);
  }, []);

  const logout = useCallback(() => {
    setDevice((current) => {
      if (!current) return current;
      const updated: DeviceState = { ...current, currentUserId: null };
      void saveDeviceState(updated);
      return updated;
    });
  }, []);

  if (device === null) {
    // Briefly shown on cold start while IndexedDB opens -- avoids a flash
    // of the onboarding flow for an already-onboarded device.
    return <div className="h-screen w-full bg-[var(--color-plane)]" />;
  }

  if (!device.consentAcceptedAt || !device.currentUserId) {
    return <OnboardingFlow device={device} onComplete={setDevice} />;
  }

  return (
    <CurrentUserProvider userId={device.currentUserId} logout={logout}>
      <SessionProvider>
        <Routes>
          <Route path="/" element={<LiveSessionPage />} />
          <Route path="/analytics" element={<AnalyticsPage />} />
          <Route path="/calibrate" element={<CalibrationPage />} />
          <Route path="/today" element={<TodayPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </SessionProvider>
    </CurrentUserProvider>
  );
}
