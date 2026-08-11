import { createContext, useContext, type ReactNode } from 'react';

interface CurrentUserContextValue {
  userId: string;
  logout: () => void;
}

const CurrentUserContext = createContext<CurrentUserContextValue | null>(null);

/** Only ever mounted once App.tsx's gate has confirmed a user is signed in, so userId is guaranteed non-null for every consumer below it. */
export function CurrentUserProvider({ userId, logout, children }: { userId: string; logout: () => void; children: ReactNode }) {
  return <CurrentUserContext.Provider value={{ userId, logout }}>{children}</CurrentUserContext.Provider>;
}

export function useCurrentUser(): CurrentUserContextValue {
  const ctx = useContext(CurrentUserContext);
  if (!ctx) throw new Error('useCurrentUser must be used within a CurrentUserProvider');
  return ctx;
}
