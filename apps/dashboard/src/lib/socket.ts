import { io, type Socket } from 'socket.io-client';
import { tokenStore } from './api';

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL ?? 'http://localhost:4000';

/**
 * One connection to the gateway's /dashboard namespace (see
 * services/gateway/src/sockets/namespaces/dashboard.namespace.js). Auth
 * travels in the handshake `auth` payload, never a header — socketAuth.js
 * verifies it as a normal access-token JWT.
 *
 * `auth` is a callback, not a static object: Socket.IO re-invokes it on
 * every (re)connection attempt, so a reconnect after the 15-minute access
 * token has expired (a dropped connection, a laptop sleep, Render idling)
 * picks up whatever's currently in tokenStore -- which the axios refresh
 * interceptor keeps current -- instead of replaying the token that was
 * live when this socket was first created and failing forever with
 * "jwt expired".
 */
export function createDashboardSocket(accessToken: string): Socket {
  return io(`${SOCKET_URL}/dashboard`, {
    auth: (cb) => cb({ token: tokenStore.getAccess() ?? accessToken }),
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
