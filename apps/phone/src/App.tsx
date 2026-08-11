import { Navigate, Route, Routes } from 'react-router-dom';
import { LiveSessionPage } from './pages/LiveSessionPage';
import { CalibrationPage } from './pages/CalibrationPage';
import { TodayPage } from './pages/TodayPage';
import { AnalyticsPage } from './pages/AnalyticsPage';
import { SessionProvider } from './context/SessionContext';

// Single-user, single-device app: no login, no mode selection — just the
// live session screen, its Analytics tab, calibration, and the end-of-day
// insight view. SessionProvider wraps every route at this level (not just
// the two that read it) so the one mic-capture/DSP subscription it owns
// survives navigation instead of being torn down and restarted.
export default function App() {
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
