const http = require('http');
const env = require('./config/env');
const logger = require('./config/logger');
const { connectDB, disconnectDB } = require('./config/db');
const createApp = require('./app');
const initSocketServer = require('./sockets');
const sessionService = require('./services/sessionService');

let httpServer;

async function start() {
  await connectDB();

  // sessionManager's in-memory session map always starts empty on a fresh
  // boot, so any session still `active` in the DB at this point belongs to
  // a previous process that never shut down cleanly (crash, forced kill) --
  // see reapOrphanedActiveSessions' docstring for why this matters.
  await sessionService.reapOrphanedActiveSessions();

  const app = createApp();
  httpServer = http.createServer(app);

  await initSocketServer(httpServer);

  httpServer.listen(env.port, () => {
    logger.info(`Gateway listening on port ${env.port}`, { env: env.env });
  });
}

async function shutdown(signal) {
  logger.info(`Received ${signal}, shutting down gracefully`);

  const forceExitTimer = setTimeout(() => {
    logger.error('Graceful shutdown timed out — forcing exit');
    process.exit(1);
  }, 10000);
  forceExitTimer.unref();

  try {
    if (httpServer) {
      await new Promise((resolve, reject) => {
        httpServer.close((err) => (err ? reject(err) : resolve()));
      });
    }
    await disconnectDB();
    logger.info('Shutdown complete');
    process.exit(0);
  } catch (err) {
    logger.error('Error during shutdown', { error: err.message });
    process.exit(1);
  }
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection', { reason: reason?.message || reason });
});

process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception — exiting', { error: err.message, stack: err.stack });
  process.exit(1);
});

start().catch((err) => {
  logger.error('Failed to start gateway', { error: err.message, stack: err.stack });
  process.exit(1);
});
