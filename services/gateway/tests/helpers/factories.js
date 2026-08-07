const User = require('../../src/models/User');
const tokenService = require('../../src/services/tokenService');
const { ROLES } = require('../../src/utils/constants');

let counter = 0;

/** Creates a persisted User and a matching valid access token, ready for an `Authorization: Bearer` header. */
async function createUserWithToken(overrides = {}) {
  counter += 1;
  const user = await User.create({
    name: overrides.name || `Test User ${counter}`,
    email: overrides.email || `test-user-${counter}@example.com`,
    passwordHash: overrides.password || 'Password123!',
    role: overrides.role || ROLES.PATIENT,
  });

  const accessToken = tokenService.generateAccessToken(user);
  return { user, accessToken };
}

function authHeader(accessToken) {
  return { Authorization: `Bearer ${accessToken}` };
}

module.exports = { createUserWithToken, authHeader };
