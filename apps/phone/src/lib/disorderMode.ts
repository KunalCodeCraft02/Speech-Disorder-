import { useCallback, useState } from 'react';
import type { DisorderMode } from '../types';

const STORAGE_KEY = 'speechbio.disorderMode';

/**
 * Persists the session-scoped disorder-mode selection (Part D's landing
 * page) across a reload within the same tab, without polluting
 * AuthContext (mode is a per-session choice, not an account-level
 * property — see CalibrationEngine notes in App.tsx). sessionStorage
 * (not localStorage) is deliberate: closing the tab should return the
 * patient to the mode-select landing page next time, not silently resume
 * whatever mode was last used.
 */
export function getStoredDisorderMode(): DisorderMode | null {
  const value = sessionStorage.getItem(STORAGE_KEY);
  return value === 'tachylalia' || value === 'bradylalia' ? value : null;
}

export function setStoredDisorderMode(mode: DisorderMode): void {
  sessionStorage.setItem(STORAGE_KEY, mode);
}

export function clearStoredDisorderMode(): void {
  sessionStorage.removeItem(STORAGE_KEY);
}

export function useDisorderMode() {
  const [disorderMode, setDisorderModeState] = useState<DisorderMode | null>(() => getStoredDisorderMode());

  const selectDisorderMode = useCallback((mode: DisorderMode) => {
    setStoredDisorderMode(mode);
    setDisorderModeState(mode);
  }, []);

  const clearDisorderMode = useCallback(() => {
    clearStoredDisorderMode();
    setDisorderModeState(null);
  }, []);

  return { disorderMode, selectDisorderMode, clearDisorderMode };
}
