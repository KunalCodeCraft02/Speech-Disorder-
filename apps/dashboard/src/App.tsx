import { useCallback, useRef, useState } from 'react';
import { useAuth } from './context/AuthContext';
import { DashboardPage } from './pages/DashboardPage';
import { LoginPage } from './pages/LoginPage';
import { Sidebar } from './components/layout/Sidebar';
import { Topbar } from './components/layout/Topbar';
import { DEMO_MODE } from './lib/dataClient';
import type { ConnectionState } from './hooks/useLiveSession';

export default function App() {
  const { user, status, logout } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [connectionState, setConnectionState] = useState<ConnectionState>('connecting');
  const resetRef = useRef<() => void>(() => {});
  const registerReset = useCallback((fn: () => void) => {
    resetRef.current = fn;
  }, []);

  if (status === 'loading') {
    return (
      <div className="flex h-screen items-center justify-center bg-[var(--color-plane)] text-sm text-[var(--color-ink-muted)]">
        Loading…
      </div>
    );
  }

  if (status === 'unauthenticated') {
    return <LoginPage />;
  }

  return (
    <div className="flex h-screen overflow-hidden bg-[var(--color-plane)]">
      <Sidebar open={sidebarOpen} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          user={user}
          connectionState={connectionState}
          sidebarOpen={sidebarOpen}
          onToggleSidebar={() => setSidebarOpen((v) => !v)}
          onReset={() => resetRef.current()}
          onLogout={logout}
          demoMode={DEMO_MODE}
        />
        <main className="flex-1 overflow-y-auto">
          <DashboardPage onConnectionChange={setConnectionState} onResetReady={registerReset} />
        </main>
      </div>
    </div>
  );
}
