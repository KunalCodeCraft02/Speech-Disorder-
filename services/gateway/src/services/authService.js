const User = require('../models/User');
const ApiError = require('../utils/ApiError');
const tokenService = require('./tokenService');

function issueTokenPair(user) {
  const accessToken = tokenService.generateAccessToken(user);
  const refreshToken = tokenService.generateRefreshToken(user);
  return { accessToken, refreshToken };
}

async function persistRefreshToken(user, refreshToken) {
  const decoded = tokenService.verifyRefreshToken(refreshToken);
  user.refreshTokens = user.refreshTokens.filter((t) => t.expiresAt > new Date());
  user.refreshTokens.push({
    tokenHash: tokenService.hashToken(refreshToken),
    expiresAt: tokenService.expiryToDate(decoded),
  });
  await user.save();
}

async function register({ name, email, password, role }) {
  const existing = await User.findOne({ email });
  if (existing) {
    throw ApiError.conflict('An account with this email already exists');
  }

  const user = new User({ name, email, passwordHash: password, role });
  await user.save();

  const tokens = issueTokenPair(user);
  await persistRefreshToken(user, tokens.refreshToken);

  return { user: user.toSafeJSON(), ...tokens };
}

async function login({ email, password }) {
  const user = await User.findOne({ email }).select('+passwordHash');
  if (!user || !(await user.comparePassword(password))) {
    throw ApiError.unauthorized('Invalid email or password');
  }

  const tokens = issueTokenPair(user);
  await persistRefreshToken(user, tokens.refreshToken);

  return { user: user.toSafeJSON(), ...tokens };
}

async function refresh(refreshToken) {
  let decoded;
  try {
    decoded = tokenService.verifyRefreshToken(refreshToken);
  } catch (err) {
    throw ApiError.unauthorized('Invalid or expired refresh token');
  }

  const user = await User.findById(decoded.sub);
  if (!user) throw ApiError.unauthorized('Invalid or expired refresh token');

  const tokenHash = tokenService.hashToken(refreshToken);
  const stored = user.refreshTokens.find((t) => t.tokenHash === tokenHash && t.expiresAt > new Date());
  if (!stored) {
    throw ApiError.unauthorized('Refresh token has been revoked or expired');
  }

  // Rotate: invalidate the used token, issue a new pair.
  user.refreshTokens = user.refreshTokens.filter((t) => t.tokenHash !== tokenHash);
  const tokens = issueTokenPair(user);
  await persistRefreshToken(user, tokens.refreshToken);

  return { user: user.toSafeJSON(), ...tokens };
}

async function logout(userId, refreshToken) {
  const user = await User.findById(userId);
  if (!user) return;

  const tokenHash = tokenService.hashToken(refreshToken);
  user.refreshTokens = user.refreshTokens.filter((t) => t.tokenHash !== tokenHash);
  await user.save();
}

module.exports = { register, login, refresh, logout };
