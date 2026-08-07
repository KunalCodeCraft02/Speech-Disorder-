const Device = require('../../src/models/Device');
const { createUserWithToken } = require('../helpers/factories');

describe('Device model', () => {
  test('creates a valid phone device for a user', async () => {
    const { user } = await createUserWithToken();
    const device = await Device.create({ userId: user._id, type: 'phone', label: "Kunal's iPhone" });

    expect(device.type).toBe('phone');
    expect(device.lastSeenAt).toBeInstanceOf(Date);
  });

  test('rejects an invalid device type', async () => {
    const { user } = await createUserWithToken();
    await expect(Device.create({ userId: user._id, type: 'toaster' })).rejects.toThrow();
  });

  test('requires a userId', async () => {
    await expect(Device.create({ type: 'dashboard' })).rejects.toThrow();
  });
});
