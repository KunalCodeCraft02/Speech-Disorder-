const winston = require('winston');
const path = require('path');
const env = require('./env');

const { combine, timestamp, errors, printf, colorize, json } = winston.format;

const devFormat = combine(
  colorize(),
  timestamp({ format: 'HH:mm:ss' }),
  errors({ stack: true }),
  printf(({ level, message, timestamp: ts, stack, ...meta }) => {
    const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
    const stackStr = stack ? `\n${stack}` : '';
    return `${ts} ${level}: ${message}${metaStr}${stackStr}`;
  })
);

const prodFormat = combine(timestamp(), errors({ stack: true }), json());

const logger = winston.createLogger({
  level: env.logLevel,
  format: env.isProduction ? prodFormat : devFormat,
  defaultMeta: { service: 'gateway' },
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({
      filename: path.resolve(process.cwd(), 'logs', 'error.log'),
      level: 'error',
    }),
    new winston.transports.File({
      filename: path.resolve(process.cwd(), 'logs', 'combined.log'),
    }),
  ],
  exitOnError: false,
});

// morgan expects a stream with a .write(message) method
logger.stream = {
  write: (message) => logger.http(message.trim()),
};

module.exports = logger;
