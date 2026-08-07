describe('connectDB / disconnectDB', () => {
  let mongoose;
  let connectDB;
  let disconnectDB;

  beforeEach(() => {
    // `connectDB`'s single-flight guard (`isConnecting`) is module-scoped
    // state, so each test needs a fresh module instance rather than reusing
    // one across assertions — otherwise only the very first call in the
    // whole file would ever actually reach mongoose.connect().
    jest.resetModules();
    jest.doMock('mongoose', () => ({
      set: jest.fn(),
      connect: jest.fn().mockResolvedValue(undefined),
      connection: {
        on: jest.fn(),
        close: jest.fn().mockResolvedValue(undefined),
        host: 'localhost',
        name: 'test-db',
      },
    }));
    mongoose = require('mongoose');
    ({ connectDB, disconnectDB } = require('../../src/config/db'));
  });

  test('connects mongoose using the configured URI and pool options', async () => {
    await connectDB();
    expect(mongoose.connect).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ maxPoolSize: 20 }));
  });

  test('registers connected/error/disconnected listeners', async () => {
    await connectDB();
    const events = mongoose.connection.on.mock.calls.map((call) => call[0]);
    expect(events).toEqual(expect.arrayContaining(['connected', 'error', 'disconnected']));
  });

  test('propagates a connection failure instead of swallowing it', async () => {
    mongoose.connect.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    await expect(connectDB()).rejects.toThrow('ECONNREFUSED');
  });

  test('a second call made while the first is still in flight is a no-op (single-flight guard)', async () => {
    const first = connectDB();
    const second = connectDB();
    await Promise.all([first, second]);
    expect(mongoose.connect).toHaveBeenCalledTimes(1);
  });

  test('disconnectDB closes the mongoose connection', async () => {
    await disconnectDB();
    expect(mongoose.connection.close).toHaveBeenCalled();
  });
});
