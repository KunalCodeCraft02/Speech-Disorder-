// Per-session summaries, stored locally and tagged with a calendar date so
// the "Today" insight screen can aggregate them. No PDF, no server — just
// what's needed to compute an end-of-day plain-language summary.

import { idbGetAllByIndex, idbPut, STORE_SESSIONS } from './db';

export interface SessionSummary {
  id: string;
  dateKey: string; // local calendar date, YYYY-MM-DD — see dateKeyFor()
  startedAt: string;
  endedAt: string;
  durationSec: number;
  avgArticulationRateSPS: number | null;
  /** Total elapsed time (sec) the confirmed classification was "tachylalia" during this session. */
  timeInTachylaliaSec: number;
  /** How many times triggerFeedback fired (vibration count) this session. */
  feedbackTriggerCount: number;
  /** The patient's calibrated baseline rate at the time of this session, for later "closer/further from baseline" comparisons. */
  baselineArticulationRateAtSession: number | null;
}

/** Local calendar date key (not UTC) — a session that runs past midnight is tagged by when it started. */
export function dateKeyFor(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export async function saveSession(summary: SessionSummary): Promise<void> {
  await idbPut(STORE_SESSIONS, summary);
}

export async function getSessionsForDate(dateKey: string): Promise<SessionSummary[]> {
  const sessions = await idbGetAllByIndex<SessionSummary>(STORE_SESSIONS, 'byDate', dateKey);
  return sessions.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
}
