import { Navigate, Route, Routes } from 'react-router-dom';
import { LiveSessionPage } from './pages/LiveSessionPage';
import { CalibrationPage } from './pages/CalibrationPage';
import { TodayPage } from './pages/TodayPage';

// Single-user, single-device app: no login, no mode selection — just the
// live session screen, calibration, and the end-of-day insight view.
export default function App() {
  return (
    <Routes>
      <Route path="/" element={<LiveSessionPage />} />
      <Route path="/calibrate" element={<CalibrationPage />} />
      <Route path="/today" element={<TodayPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
