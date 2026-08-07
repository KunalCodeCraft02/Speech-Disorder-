const jwt = require('jsonwebtoken');
const tokenService = require('../../src/services/tokenService');
const env = require('../../src/config/env');

const fakeUser = { _id: { toString: () => '64a1b2c3d4e5f6a7b8c9d0e1' }, role: 'patient', email: 'a@b.com' };

describe('tokenService', () => {
  test('generateAccessToken embeds role/email and the user id as subject', () => {
    const token = tokenService.generateAccessToken(fakeUser);
    const decoded = jwt.verify(token, env.jwt.accessSecret);
    expect(decoded.sub).toBe('64a1b2c3d4e5f6a7b8c9d0e1');
    expect(decoded.role).toBe('patient');
    expect(decoded.email).toBe('a@b.com');
  });

  test('generateRefreshToken carries a unique jti and no role/email claims', () => {
    const token1 = tokenService.generateRefreshToken(fakeUser);
    const token2 = tokenService.generateRefreshToken(fakeUser);
    const decoded1 = jwt.verify(token1, env.jwt.refreshSecret);
    const decoded2 = jwt.verify(token2, env.jwt.refreshSecret);

    expect(decoded1.sub).toBe('64a1b2c3d4e5f6a7b8c9d0e1');
    expect(decoded1.role).toBeUndefined();
    expect(decoded1.jti).toBeDefined();
    expect(decoded1.jti).not.toBe(decoded2.jti);
  });

  test('verifyAccessToken rejects a token signed with the wrong secret', () => {
    const badToken = jwt.sign({}, 'some-other-secret', { subject: 'x' });
    expect(() => tokenService.verifyAccessToken(badToken)).toThrow();
  });

  test('verifyAccessToken rejects an expired token', () => {
    const expired = jwt.sign({ role: 'patient' }, env.jwt.accessSecret, { subject: 'x', expiresIn: -10 });
    expect(() => tokenService.verifyAccessToken(expired)).toThrow(/expired/);
  });

  test('verifyRefreshToken round-trips a token from generateRefreshToken', () => {
    const token = tokenService.generateRefreshToken(fakeUser);
    const decoded = tokenService.verifyRefreshToken(token);
    expect(decoded.sub).toBe('64a1b2c3d4e5f6a7b8c9d0e1');
  });

  test('hashToken is deterministic and does not return the raw token', () => {
    const a = tokenService.hashToken('same-token');
    const b = tokenService.hashToken('same-token');
    expect(a).toBe(b);
    expect(a).not.toBe('same-token');
    expect(a).toMatch(/^[0-9a-f]{64}$/); // sha256 hex digest
  });

  test('hashToken produces different hashes for different tokens', () => {
    expect(tokenService.hashToken('token-a')).not.toBe(tokenService.hashToken('token-b'));
  });

  test('expiryToDate converts a numeric exp claim into a Date', () => {
    const date = tokenService.expiryToDate({ exp: 1700000000 });
    expect(date).toBeInstanceOf(Date);
    expect(date.getTime()).toBe(1700000000 * 1000);
  });
});
