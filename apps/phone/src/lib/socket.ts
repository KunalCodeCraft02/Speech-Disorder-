import { io, type Socket } from 'socket.io-client';
import { tokenStore } from './api';

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL ?? 'http://localhost:4000';

// `auth` is a callback, not a static object: Socket.IO re-invokes it on
// every (re)connection attempt, so a reconnect after the 15-minute access
// token has expired (a dropped connection, screen lock, Render idling)
// picks up whatever's currently in tokenStore -- which the axios refresh
// interceptor keeps current -- instead of replaying the token that was
// live when this socket was first created and failing forever with
// "jwt expired".
function connect(namespace: string, accessToken: string): Socket {
  return io(`${SOCKET_URL}${namespace}`, {
    auth: (cb) => cb({ token: tokenStore.getAccess() ?? accessToken }),
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 500,
    reconnectionDelayMax: 5000,
  });
}

/** services/gateway's /device namespace — session start/stop, audio:chunk, vibration:command. */
export const createDeviceSocket = (accessToken: string) => connect('/device', accessToken);

/** services/gateway's /dashboard namespace — used here only to self-subscribe for classification. */
export const createDashboardSocket = (accessToken: string) => connect('/dashboard', accessToken);

export const DEVICE_EVENTS = {
  sessionStart: 'session:start',
  audioChunk: 'audio:chunk',
  heartbeat: 'device:heartbeat',
  sessionStop: 'session:stop',

  sessionAck: 'session:ack',
  vibrationCommand: 'vibration:command',
  sessionError: 'session:error',
} as const;

export const DASHBOARD_EVENTS = {
  subscribeUser: 'dashboard:subscribeUser',
  subscribeSession: 'dashboard:subscribe',
  unsubscribeSession: 'dashboard:unsubscribe',
  metricsUpdate: 'metrics:update',
  sessionError: 'session:error',
} as const;
