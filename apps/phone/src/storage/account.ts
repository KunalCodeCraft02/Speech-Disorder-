// Local-only device account: consent acceptance + a single named profile
// gated by a PIN, both stored in IndexedDB. There is no server and no real
// multi-account system here -- this mirrors storage/calibration.ts's
// singleton-record pattern (one record, overwritten in place), consistent
// with the rest of this app's single-device design. "Login/Sign-Up" is a
// local passcode gate, not a network-authenticated account.

import { ACCOUNT_KEY, idbGet, idbPut, STORE_ACCOUNT } from './db';

export interface AccountRecord {
  /** Non-null once the Terms & Conditions consent screen has been accepted -- gates whether it's shown again. */
  consentAcceptedAt: string | null;
  profileName: string | null;
  pinHash: string | null;
  /** Whether this device is currently "signed in" -- once true it stays true (no logout flow), matching this app's single-user-per-device design. */
  loggedIn: boolean;
}

const EMPTY_ACCOUNT: AccountRecord = {
  consentAcceptedAt: null,
  profileName: null,
  pinHash: null,
  loggedIn: false,
};

export async function getAccount(): Promise<AccountRecord> {
  const record = await idbGet<AccountRecord>(STORE_ACCOUNT, ACCOUNT_KEY);
  return record ?? EMPTY_ACCOUNT;
}

export async function saveAccount(record: AccountRecord): Promise<void> {
  await idbPut(STORE_ACCOUNT, record, ACCOUNT_KEY);
}
