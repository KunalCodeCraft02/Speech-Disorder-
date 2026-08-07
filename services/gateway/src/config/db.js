const mongoose = require('mongoose');
const env = require('./env');
const logger = require('./logger');

mongoose.set('strictQuery', true);

let isConnecting = false;

async function connectDB() {
  if (isConnecting) return;
  isConnecting = true;

  mongoose.connection.on('connected', () => {
    logger.info('MongoDB connected', { host: mongoose.connection.host, db: mongoose.connection.name });
  });

  mongoose.connection.on('error', (err) => {
    logger.error('MongoDB connection error', { error: err.message });
  });

  mongoose.connection.on('disconnected', () => {
    logger.warn('MongoDB disconnected');
  });

  try {
    await mongoose.connect(env.mongoUri, {
      maxPoolSize: 20,
      serverSelectionTimeoutMS: 10000,
      autoIndex: !env.isProduction,
    });
  } catch (err) {
    logger.error('Initial MongoDB connection failed', { error: err.message });
    throw err;
  }
}

async function disconnectDB() {
  await mongoose.connection.close();
}

module.exports = { connectDB, disconnectDB };
