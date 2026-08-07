const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const env = require('../config/env');

function generateAccessToken(user) {
  return jwt.sign({ role: user.role, email: user.email }, env.jwt.accessSecret, {
    subject: user._id.toString(),
    expiresIn: env.jwt.accessExpiresIn,
  });
}

function generateRefreshToken(user) {
  return jwt.sign({}, env.jwt.refreshSecret, {
    subject: user._id.toString(),
    expiresIn: env.jwt.refreshExpiresIn,
    jwtid: crypto.randomUUID(),
  });
}

function verifyAccessToken(token) {
  return jwt.verify(token, env.jwt.accessSecret);
}

function verifyRefreshToken(token) {
  return jwt.verify(token, env.jwt.refreshSecret);
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/** Decodes an expiry claim (seconds since epoch) into a JS Date. */
function expiryToDate(decoded) {
  return new Date(decoded.exp * 1000);
}

module.exports = {
  generateAccessToken,
  generateRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  hashToken,
  expiryToDate,
};
