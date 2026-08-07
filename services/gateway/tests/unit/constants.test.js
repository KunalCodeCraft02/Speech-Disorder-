const {
  sessionRoom,
  userRoom,
  ROLES,
  SESSION_STATUS,
  CLASSIFICATION,
  DISORDER_MODE,
  VIBRATION_PATTERNS,
  PITCH_ALERT_VIBRATION_PATTERN,
} = require('../../src/utils/constants');

describe('room name helpers', () => {
  test('sessionRoom namespaces by session id', () => {
    expect(sessionRoom('abc123')).toBe('session:abc123');
  });

  test('userRoom namespaces by user id', () => {
    expect(userRoom('u1')).toBe('user:u1');
  });
});

describe('enum shape', () => {
  test('ROLES has the three expected roles', () => {
    expect(Object.values(ROLES).sort()).toEqual(['admin', 'clinician', 'patient']);
  });

  test('SESSION_STATUS has the three expected states', () => {
    expect(Object.values(SESSION_STATUS).sort()).toEqual(['aborted', 'active', 'completed']);
  });

  test('CLASSIFICATION has the four expected classes', () => {
    expect(Object.values(CLASSIFICATION).sort()).toEqual(['bradylalia', 'normal', 'tachylalia', 'uncalibrated']);
  });

  test('DISORDER_MODE has the two expected modes', () => {
    expect(Object.values(DISORDER_MODE).sort()).toEqual(['bradylalia', 'tachylalia']);
  });

  test('VIBRATION_PATTERNS is keyed by disorderMode and each pattern differs from the pitch-alert pattern', () => {
    expect(VIBRATION_PATTERNS[DISORDER_MODE.TACHYLALIA]).toEqual([80, 60, 80, 60, 80]);
    expect(VIBRATION_PATTERNS[DISORDER_MODE.BRADYLALIA]).toEqual([300, 150, 300]);
    expect(VIBRATION_PATTERNS[DISORDER_MODE.TACHYLALIA]).not.toEqual(PITCH_ALERT_VIBRATION_PATTERN);
    expect(VIBRATION_PATTERNS[DISORDER_MODE.BRADYLALIA]).not.toEqual(PITCH_ALERT_VIBRATION_PATTERN);
  });

  test('enums are frozen', () => {
    expect(Object.isFrozen(ROLES)).toBe(true);
    expect(() => {
      ROLES.PATIENT = 'hacked';
    }).not.toThrow(); // non-strict assignment to a frozen object silently no-ops
    expect(ROLES.PATIENT).toBe('patient');
  });
});
