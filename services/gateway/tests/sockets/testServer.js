const http = require('http');
const { io: ioClient } = require('socket.io-client');
const initSocketServer = require('../../src/sockets');

async function startTestServer() {
  const httpServer = http.createServer();
  const io = await initSocketServer(httpServer);
  await new Promise((resolve) => httpServer.listen(0, resolve));
  const { port } = httpServer.address();
  return {
    port,
    async stop() {
      // `io.close()` disconnects every socket and clears its internal
      // engine.io heartbeat timers; closing only the raw httpServer leaves
      // those timers pending and Jest force-exits the worker.
      await new Promise((resolve) => io.close(resolve));
    },
  };
}

function connectClient(port, namespace, token) {
  return ioClient(`http://127.0.0.1:${port}${namespace}`, {
    auth: token ? { token } : undefined,
    transports: ['websocket'],
    reconnection: false,
    forceNew: true,
  });
}

/** Resolves with the event's payload, or rejects on a connect_error / timeout. */
function waitForEvent(socket, event, timeoutMs = 4000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for "${event}"`)), timeoutMs);

    socket.once(event, (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });

    if (event !== 'connect_error') {
      socket.once('connect_error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    }
  });
}

function emitAck(socket, event, payload, timeoutMs = 4000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for an ack to "${event}"`)), timeoutMs);
    socket.emit(event, payload, (ack) => {
      clearTimeout(timer);
      resolve(ack);
    });
  });
}

module.exports = { startTestServer, connectClient, waitForEvent, emitAck };
