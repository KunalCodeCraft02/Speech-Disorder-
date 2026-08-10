import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import { registerSW } from 'virtual:pwa-register';
import './index.css';
import App from './App.tsx';

// Installs/updates the offline service worker (see vite.config.ts) — the
// app shell + AudioWorklet module get precached on first load, so every
// later launch (including with no network at all) serves entirely from
// the cache.
registerSW({ immediate: true });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </StrictMode>
);
