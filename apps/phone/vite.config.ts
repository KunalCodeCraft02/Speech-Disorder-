import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
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
  plugins: [react()],
  server: {
    host: true,
    port: 5174,
    https: {
      cert: readFileSync('.certs/cert.pem'),
      key: readFileSync('.certs/key.pem'),
    },
  },
})
