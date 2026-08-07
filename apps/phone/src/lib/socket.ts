import { io, type Socket } from 'socket.io-client';

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL ?? 'http://localhost:4000';

function connect(namespace: string, accessToken: string): Socket {
  return io(`${SOCKET_URL}${namespace}`, {
    auth: { token: accessToken },
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
