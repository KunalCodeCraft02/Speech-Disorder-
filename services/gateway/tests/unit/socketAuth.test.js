jest.mock('../../src/services/tokenService');
jest.mock('../../src/config/env', () => ({ disableAuth: false, devUserId: null }));

const tokenService = require('../../src/services/tokenService');
const env = require('../../src/config/env');
const socketAuth = require('../../src/sockets/socketAuth');

function mockSocket(auth = {}) {
  return { handshake: { auth, query: {} } };
}

describe('socketAuth', () => {
  afterEach(() => {
    jest.resetAllMocks();
    env.disableAuth = false;
    env.devUserId = null;
  });

  test('DISABLE_AUTH=true attaches the fixed dev user without a token', () => {
    env.disableAuth = true;
    env.devUserId = 'dev-user-id';
    const socket = mockSocket(); // no token supplied at all
    const next = jest.fn();
    socketAuth(socket, next);

    expect(socket.user).toEqual({ id: 'dev-user-id', role: 'patient', email: 'dev@local' });
    expect(next).toHaveBeenCalledWith();
    expect(tokenService.verifyAccessToken).not.toHaveBeenCalled();
  });

  test('rejects a connection with no token when auth is enabled', () => {
    const socket = mockSocket();
    const next = jest.fn();
    socketAuth(socket, next);

    expect(next).toHaveBeenCalledWith(expect.any(Error));
    expect(next.mock.calls[0][0].message).toBe('AUTH_REQUIRED');
  });

  test('rejects a token tokenService fails to verify', () => {
    tokenService.verifyAccessToken.mockImplementation(() => {
      throw new Error('bad signature');
    });
    const socket = mockSocket({ token: 'bad-token' });
    const next = jest.fn();
    socketAuth(socket, next);

    expect(next.mock.calls[0][0].message).toBe('AUTH_INVALID');
  });

  test('attaches socket.user on a valid token', () => {
    tokenService.verifyAccessToken.mockReturnValue({ sub: 'user-1', role: 'patient', email: 'p@x.com' });
    const socket = mockSocket({ token: 'good-token' });
    const next = jest.fn();
    socketAuth(socket, next);

    expect(socket.user).toEqual({ id: 'user-1', role: 'patient', email: 'p@x.com' });
    expect(next).toHaveBeenCalledWith();
  });
});
