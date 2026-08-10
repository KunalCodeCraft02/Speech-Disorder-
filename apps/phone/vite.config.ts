import { existsSync, readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig(({ command }) => {
  // HTTPS is required here (not optional): browsers only expose
  // navigator.mediaDevices.getUserMedia in a "secure context", and a LAN IP
  // like http://172.16.x.x is not one — only https:// or http://localhost
  // qualify. The phone connects over the LAN, so it needs a cert covering
  // that IP.
  //
  // @vitejs/plugin-basic-ssl's `domains` option can't do this: it adds
  // entries as DNS-type SAN, and browsers reject a DNS-type SAN when the
  // page is loaded via a numeric IP (RFC 6125 requires an IP-type SAN for
  // that). So instead we use a cert generated with openssl directly (see
  // .certs/openssl.cnf) that has a real `IP.2 = 172.15.4.184` SAN entry.
  // Regenerate .certs/{cert,key}.pem (and update the IP in openssl.cnf) if
  // the laptop's LAN IP changes.
  //
  // Only wired up for `vite dev` (command === 'serve') -- `.certs/*.pem`
  // is gitignored (never committed) and irrelevant for `vite build`: a
  // production build has no dev server to attach HTTPS options to, and a
  // static host serves the production build over its own HTTPS anyway.
  // Reading these unconditionally broke every hosted build with an ENOENT
  // for a file that was never supposed to exist outside a laptop checkout.
  const certPath = '.certs/cert.pem'
  const keyPath = '.certs/key.pem'
  const hasLocalCerts = command === 'serve' && existsSync(certPath) && existsSync(keyPath)

  return {
    plugins: [
      react(),
      // Makes the built app installable and fully offline after first
      // load: precaches the app shell (JS/CSS/HTML + the AudioWorklet
      // module under public/worklets, which live-session capture depends
      // on) via a generated service worker, and registers it from
      // src/main.tsx. `autoUpdate` means a new deployed build replaces the
      // cached one silently on next launch, without needing a manual
      // "update available" prompt.
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['favicon.svg', 'icons.svg', 'worklets/pcm-capture-processor.js'],
        manifest: {
          name: 'Speech Biofeedback',
          short_name: 'Speech Biofeedback',
          description: 'Offline, on-device tachylalia (fast-speech) biofeedback: live monitoring, calibration, and vibration alerts — no account, no server.',
          start_url: '/',
          scope: '/',
          display: 'standalone',
          orientation: 'portrait',
          background_color: '#070a12',
          theme_color: '#070a12',
          icons: [
            { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
            { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
            { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
        },
        workbox: {
          // Precache the full app shell (JS/CSS/HTML/SVG/PNG, including
          // the AudioWorklet processor under /worklets) so a fresh install
          // works from the very first launch with the network already off.
          globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
          navigateFallback: 'index.html',
        },
        devOptions: {
          // Lets `vite dev` exercise the service worker too, so offline
          // behavior can be checked before a production build.
          enabled: true,
        },
      }),
    ],
    server: {
      host: true,
      port: 5174,
      ...(hasLocalCerts
        ? { https: { cert: readFileSync(certPath), key: readFileSync(keyPath) } }
        : {}),
    },
  }
})
