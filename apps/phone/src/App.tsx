import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import { ModeSelectPage } from './pages/ModeSelectPage';
import { DevicePage } from './pages/DevicePage';
import { CalibrationPage } from './pages/CalibrationPage';
import { LoginPage } from './pages/LoginPage';

export default function App() {
  const { status } = useAuth();

  if (status === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--color-plane)] text-sm text-[var(--color-ink-muted)]">
        Loading…
      </div>
    );
  }

  if (status === 'unauthenticated') {
    return <LoginPage />;
  }

  return (
    <Routes>
      {/* Part D: mode-select landing page, shown before every Live Session. */}
      <Route path="/" element={<ModeSelectPage />} />
      <Route path="/session" element={<DevicePage />} />
      <Route path="/calibrate" element={<CalibrationPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
