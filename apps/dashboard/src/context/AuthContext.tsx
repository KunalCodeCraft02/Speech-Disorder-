import { createContext, use, useCallback, useEffect, useState, type ReactNode } from 'react';
import type { Role, User } from '../types';
import { DEMO_MODE, dataClient, tokenStore } from '../lib/dataClient';
import { api, extractApiErrorMessage } from '../lib/api';

export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

interface AuthContextValue {
  user: User | null;
  status: AuthStatus;
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string, role?: Role) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

// Local-dev convenience only: if set, silently signs in as this account on
// first load with no stored session -- lets the phone and dashboard boot
// straight into the same patient without typing credentials twice. Real
// multi-user login still works normally: log out (Topbar) to reach the
// login form and sign in as anyone else.
const AUTO_LOGIN_EMAIL = import.meta.env.VITE_AUTO_LOGIN_EMAIL as string | undefined;
const AUTO_LOGIN_PASSWORD = import.meta.env.VITE_AUTO_LOGIN_PASSWORD as string | undefined;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [status, setStatus] = useState<AuthStatus>('loading');

  useEffect(() => {
    let cancelled = false;

    async function restore() {
      if (tokenStore.getAccess()) {
        try {
          const me = await dataClient.me();
          if (!cancelled) {
            setUser(me);
            setStatus('authenticated');
          }
          return;
        } catch {
          tokenStore.clear();
        }
      }

      if (AUTO_LOGIN_EMAIL && AUTO_LOGIN_PASSWORD) {
        try {
          const result = await dataClient.login(AUTO_LOGIN_EMAIL, AUTO_LOGIN_PASSWORD);
          tokenStore.set(result.accessToken, result.refreshToken);
          if (!cancelled) {
            setUser(result.user);
            setStatus('authenticated');
          }
          return;
        } catch {
          // Fall through to the login screen -- bad/missing auto-login
          // credentials should never brick the app.
        }
      }

      if (!cancelled) setStatus('unauthenticated');
    }

    restore();
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    try {
      const result = await dataClient.login(email, password);
      tokenStore.set(result.accessToken, result.refreshToken);
      setUser(result.user);
      setStatus('authenticated');
    } catch (err) {
      throw new Error(extractApiErrorMessage(err, 'Invalid email or password'));
    }
  }, []);

  const register = useCallback(async (name: string, email: string, password: string, role?: Role) => {
    try {
      // Demo mode has no real backend to register against -- reuse the
      // demo login so the "create account" flow still works end to end.
      if (DEMO_MODE) {
        const result = await dataClient.login(email, password);
        tokenStore.set(result.accessToken, result.refreshToken);
        setUser(result.user);
        setStatus('authenticated');
        return;
      }

      const res = await api.post('/auth/register', { name, email, password, role });
      const { user: newUser, accessToken, refreshToken } = res.data.data;
      tokenStore.set(accessToken, refreshToken);
      setUser(newUser);
      setStatus('authenticated');
    } catch (err) {
      throw new Error(extractApiErrorMessage(err, 'Could not create account'));
    }
  }, []);

  const logout = useCallback(() => {
    tokenStore.clear();
    setUser(null);
    setStatus('unauthenticated');
  }, []);

  return <AuthContext value={{ user, status, login, register, logout }}>{children}</AuthContext>;
}

export function useAuth() {
  const ctx = use(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
