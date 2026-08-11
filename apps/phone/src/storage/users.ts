// Local, on-device user profiles -- this app has no server, so a "user" is
// just a named profile + PIN hash gating this device (see lib/pinHash.ts).
// Multiple profiles can exist on one device (e.g. a shared family tablet),
// each with its own calibration (storage/calibration.ts, keyed by the same
// user id) kept fully separate from the others.

import { idbGet, idbGetAll, idbPut, STORE_USERS } from './db';

export interface UserRecord {
  id: string;
  profileName: string;
  pinHash: string;
  createdAt: string;
}

export async function listUsers(): Promise<UserRecord[]> {
  return idbGetAll<UserRecord>(STORE_USERS);
}

export async function getUserById(id: string): Promise<UserRecord | null> {
  const record = await idbGet<UserRecord>(STORE_USERS, id);
  return record ?? null;
}

/** Case-insensitive, whitespace-trimmed match -- there is no login concept beyond "which locally stored name did you type." */
export async function findUserByName(name: string): Promise<UserRecord | null> {
  const target = name.trim().toLowerCase();
  const users = await listUsers();
  return users.find((u) => u.profileName.trim().toLowerCase() === target) ?? null;
}

export async function createUser(profileName: string, pinHash: string): Promise<UserRecord> {
  const record: UserRecord = {
    id: crypto.randomUUID(),
    profileName: profileName.trim(),
    pinHash,
    createdAt: new Date().toISOString(),
  };
  await idbPut(STORE_USERS, record);
  return record;
}
