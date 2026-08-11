// Local device-passcode hashing -- this app has no server, so there is no
// account to breach remotely; the PIN only ever gates this one device's
// local IndexedDB. It's still hashed (never stored/compared in plain text)
// via the Web Crypto API already available in every target runtime
// (browser + Capacitor WebView), rather than treating "local-only" as an
// excuse to skip hashing entirely.

const SALT = 'speechbio-local-v1';

export async function hashPin(pin: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${SALT}:${pin}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
