import { io, type Socket } from 'socket.io-client';

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL ?? 'http://localhost:4000';

/**
 * One connection to the gateway's /dashboard namespace (see
 * services/gateway/src/sockets/namespaces/dashboard.namespace.js). Auth
 * travels in the handshake `auth` payload, never a header — socketAuth.js
 * verifies it as a normal access-token JWT.
 */
export function createDashboardSocket(accessToken: string): Socket {
  return io(`${SOCKET_URL}/dashboard`, {
    auth: { token: accessToken },
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 500,
    reconnectionDelayMax: 5000,
  });
}

export const DASHBOARD_EVENTS = {
  subscribeUser: 'dashboard:subscribeUser',
  subscribeSession: 'dashboard:subscribe',
  unsubscribeSession: 'dashboard:unsubscribe',

  sessionStarted: 'session:started',
  metricsUpdate: 'metrics:update',
  feedbackLogged: 'feedback:logged',
  sessionEnded: 'session:ended',
  sessionError: 'session:error',
} as const;
