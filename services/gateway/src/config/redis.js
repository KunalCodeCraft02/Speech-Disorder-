const { createClient } = require('redis');
const env = require('./env');
const logger = require('./logger');

/**
 * Redis is optional. Without REDIS_URL the gateway runs single-instance with
 * Socket.IO's default in-memory adapter — fine for development, insufficient
 * once the gateway is scaled to more than one pod (see architecture §10).
 */
async function createRedisClients() {
  if (!env.redisUrl) {
    logger.warn('REDIS_URL not set — Socket.IO adapter running in-memory (single instance only)');
    return null;
  }

  const pubClient = createClient({ url: env.redisUrl });
  const subClient = pubClient.duplicate();

  pubClient.on('error', (err) => logger.error('Redis pub client error', { error: err.message }));
  subClient.on('error', (err) => logger.error('Redis sub client error', { error: err.message }));

  await Promise.all([pubClient.connect(), subClient.connect()]);
  logger.info('Redis pub/sub clients connected');

  return { pubClient, subClient };
}

module.exports = { createRedisClients };
