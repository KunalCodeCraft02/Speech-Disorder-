// End-of-day insight: a plain-language local summary computed entirely
// from locally stored session data — no PDF, no server. Available
// on-demand from the "Today" view, or naturally once a new calendar day
// starts (yesterday's sessions become "yesterday" for the comparison).

import { dateKeyFor, getSessionsForDate, type SessionSummary } from './sessions';

export interface DailySummary {
  dateKey: string;
  sessionCount: number;
  totalPracticeSec: number;
  avgArticulationRateSPS: number | null;
  tachylaliaPercent: number; // % of total practice time spent in confirmed tachylalia
  feedbackTriggerCount: number;
  /** null if there's no baseline, or no rate data to compare. */
  baselineDeltaPercent: number | null;
  sessions: SessionSummary[];
}

function summarizeDay(dateKey: string, sessions: SessionSummary[]): DailySummary {
  const totalPracticeSec = sessions.reduce((sum, s) => sum + s.durationSec, 0);
  const tachylaliaSec = sessions.reduce((sum, s) => sum + s.timeInTachylaliaSec, 0);
  const feedbackTriggerCount = sessions.reduce((sum, s) => sum + s.feedbackTriggerCount, 0);

  // Duration-weighted average articulation rate across the day's sessions.
  const rateWeightedSum = sessions.reduce((sum, s) => sum + (s.avgArticulationRateSPS ?? 0) * s.durationSec, 0);
  const rateWeightDuration = sessions.reduce((sum, s) => sum + (s.avgArticulationRateSPS != null ? s.durationSec : 0), 0);
  const avgArticulationRateSPS = rateWeightDuration > 0 ? rateWeightedSum / rateWeightDuration : null;

  const latestBaseline = [...sessions].reverse().find((s) => s.baselineArticulationRateAtSession != null)?.baselineArticulationRateAtSession ?? null;
  const baselineDeltaPercent =
    avgArticulationRateSPS != null && latestBaseline != null && latestBaseline > 0
      ? ((avgArticulationRateSPS - latestBaseline) / latestBaseline) * 100
      : null;

  return {
    dateKey,
    sessionCount: sessions.length,
    totalPracticeSec,
    avgArticulationRateSPS,
    tachylaliaPercent: totalPracticeSec > 0 ? (100 * tachylaliaSec) / totalPracticeSec : 0,
    feedbackTriggerCount,
    baselineDeltaPercent,
    sessions,
  };
}

export async function getDailySummary(date: Date = new Date()): Promise<DailySummary> {
  const dateKey = dateKeyFor(date);
  const sessions = await getSessionsForDate(dateKey);
  return summarizeDay(dateKey, sessions);
}

function formatDuration(totalSec: number): string {
  const minutes = Math.round(totalSec / 60);
  if (minutes < 1) return `${Math.round(totalSec)}s`;
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rem = minutes % 60;
  return rem === 0 ? `${hours}h` : `${hours}h ${rem}min`;
}

/**
 * Plain-language end-of-day summary: total practice time, session count, %
 * of time in tachylalia vs. normal, and whether today's average rate was
 * closer to or further from baseline than yesterday.
 */
export async function generateDailyInsight(date: Date = new Date()): Promise<string> {
  const today = await getDailySummary(date);

  if (today.sessionCount === 0) {
    return "No practice sessions recorded today yet. Start a Live Session to begin tracking.";
  }

  const yesterdayDate = new Date(date);
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  const yesterday = await getDailySummary(yesterdayDate);

  const parts: string[] = [];

  parts.push(
    `You practiced for ${formatDuration(today.totalPracticeSec)} across ${today.sessionCount} session${today.sessionCount === 1 ? '' : 's'} today.`
  );

  parts.push(`${Math.round(today.tachylaliaPercent)}% of your speaking time was flagged as too fast (tachylalia), the rest was within your normal range.`);

  if (today.feedbackTriggerCount > 0) {
    parts.push(`You received ${today.feedbackTriggerCount} vibration alert${today.feedbackTriggerCount === 1 ? '' : 's'} to slow down.`);
  } else {
    parts.push('You received no fast-speech alerts today.');
  }

  if (today.baselineDeltaPercent != null && yesterday.baselineDeltaPercent != null) {
    const todayAbs = Math.abs(today.baselineDeltaPercent);
    const yesterdayAbs = Math.abs(yesterday.baselineDeltaPercent);
    if (todayAbs < yesterdayAbs - 0.5) {
      parts.push("Your average speaking rate today was closer to your calibrated baseline than yesterday — nice progress.");
    } else if (todayAbs > yesterdayAbs + 0.5) {
      parts.push('Your average speaking rate today drifted further from your calibrated baseline than yesterday.');
    } else {
      parts.push('Your average speaking rate today was about as close to your calibrated baseline as yesterday.');
    }
  } else if (today.baselineDeltaPercent != null) {
    parts.push(
      today.baselineDeltaPercent >= 0
        ? `Your average rate today was ${Math.abs(today.baselineDeltaPercent).toFixed(0)}% above your calibrated baseline.`
        : `Your average rate today was ${Math.abs(today.baselineDeltaPercent).toFixed(0)}% below your calibrated baseline.`
    );
  }

  return parts.join(' ');
}
