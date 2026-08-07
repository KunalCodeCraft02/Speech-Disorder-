jest.mock('../../src/config/env', () => ({
  dsp: {
    restUrl: 'http://dsp.local',
    serviceToken: '',
    connectTimeoutMs: 5000,
    calibrationTimeoutMs: 30000,
  },
}));

const dspRestClient = require('../../src/services/dspRestClient');

describe('requestCalibration timeout', () => {
  let timeoutSpy;
  let fetchMock;

  beforeEach(() => {
    timeoutSpy = jest.spyOn(AbortSignal, 'timeout');
    fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ baselineArticulationRate: 4.0 }),
    });
    global.fetch = fetchMock;
  });

  afterEach(() => {
    timeoutSpy.mockRestore();
    delete global.fetch;
  });

  test('uses the dedicated calibration timeout, not the connection timeout', async () => {
    // /calibrate re-runs the full DSP pipeline per clip and per sub-window
    // (Part A.2) against real ~20-40s recordings -- it needs a much bigger
    // budget than opening a connection, so this must never regress to
    // reusing connectTimeoutMs (which is what caused real calibration
    // recordings to time out with a generic 500).
    await dspRestClient.requestCalibration({ userId: 'u1', referenceStats: {} });

    expect(timeoutSpy).toHaveBeenCalledWith(30000);
    expect(timeoutSpy).not.toHaveBeenCalledWith(5000);
  });
});
