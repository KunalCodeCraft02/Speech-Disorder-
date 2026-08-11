// Device-level state: Terms & Conditions consent (device-wide -- accepting
// it isn't a per-profile thing) and which locally stored user profile (if
// any) is currently signed in on this device. See storage/users.ts for the
// actual profile records and storage/calibration.ts for per-user
// calibration, both keyed by userId.

import { ACCOUNT_KEY, idbGet, idbPut, STORE_ACCOUNT } from './db';

export interface DeviceState {
  /** Non-null once the Terms & Conditions consent screen has been accepted -- gates whether it's shown again. */
  consentAcceptedAt: string | null;
  /** The signed-in user's id, or null if signed out. No logout flow existed before the multi-user calibration feature; logging out now just clears this so a different local profile can log in. */
  currentUserId: string | null;
}

const EMPTY_STATE: DeviceState = {
  consentAcceptedAt: null,
  currentUserId: null,
};

export async function getDeviceState(): Promise<DeviceState> {
  const record = await idbGet<DeviceState>(STORE_ACCOUNT, ACCOUNT_KEY);
  return record ?? EMPTY_STATE;
}

export async function saveDeviceState(state: DeviceState): Promise<void> {
  await idbPut(STORE_ACCOUNT, state, ACCOUNT_KEY);
}
