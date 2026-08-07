import type {
  CalibrationProfile,
  Classification,
  FeedbackEvent,
  MetricsFrame,
  Paginated,
  Report,
  Session,
  SpeechMetricDoc,
  User,
} from '../types';
import type { DashboardTransport, TransportHandler } from './transport';
import { base64ToBlob, triggerBlobDownload } from './downloadFile';
import { DEMO_REPORT_PDF_BASE64 } from './demoReportPdf';

/**
 * Self-contained in-browser simulator standing in for the real
 * gateway + FastAPI DSP stack (services/gateway, services/dsp-service).
 * Emits the exact same event names/payload shapes those services produce
 * (see MetricsFrame / session lifecycle events in src/types), so every
 * consumer — hooks, charts, gauges — is identical whether it's plugged
 * into this or the real backend. Toggle off via VITE_DEMO_MODE=false.
 */

const DEMO_USER: User = {
  id: 'demo-user-0001',
  name: 'Demo Patient',
  email: 'demo@speechbio.local',
  role: 'patient',
  createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 30).toISOString(),
};

const DEMO_SESSION_ID = 'demo-session-0001';
const BASELINE_ARTICULATION_SPS = 4.2;
const BASELINE_PAUSE_RATIO = 0.18;
const TACHY_THRESHOLD = 5.3;
const BRADY_THRESHOLD = 2.9;

const BASELINE_ARTICULATION_STD = 0.55;
const BASELINE_PAUSE_RATIO_STD = 0.5; // speechToPauseRatio scale, not a 0..1 fraction
const BASELINE_SYLLABLE_DURATION_SEC = 0.21;
const BASELINE_SYLLABLE_DURATION_STD = 0.03;

const DEMO_CALIBRATION: CalibrationProfile = {
  userId: DEMO_USER.id,
  baselineArticulationRate: BASELINE_ARTICULATION_SPS,
  baselineArticulationRateStd: BASELINE_ARTICULATION_STD,
  baselinePauseRatio: (1 - BASELINE_PAUSE_RATIO) / BASELINE_PAUSE_RATIO,
  baselinePauseRatioStd: BASELINE_PAUSE_RATIO_STD,
  baselineSyllableDurationSec: BASELINE_SYLLABLE_DURATION_SEC,
  baselineSyllableDurationStd: BASELINE_SYLLABLE_DURATION_STD,
  baselineIpuLengthSec: 1.1,
  baselineIpuLengthStd: 0.3,
  isPersonal: true,
  tachylaliaThreshold: TACHY_THRESHOLD,
  bradylaliaThreshold: BRADY_THRESHOLD,
  baselineSpeechRateWPM: BASELINE_ARTICULATION_SPS * 131,
  baselinePitchHz: 187.4,
  baselineLoudnessDb: -19.8,
  baselinePauseDurationSec: 0.42,
  baselineSpeechRatio: 1 - BASELINE_PAUSE_RATIO - 0.04,
  calibrationDurationSec: 40,
  calibrationSyllableCount: 168,
  calibratedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 3).toISOString(),
};

function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v));
}

/** Bounded random walk: nudges `value` by up to `step` and reflects off the bounds. */
function walk(value: number, step: number, min: number, max: number) {
  const next = value + (Math.random() * 2 - 1) * step;
  return clamp(next, min, max);
}

function classify(articulationRateSPS: number): Classification {
  if (articulationRateSPS > TACHY_THRESHOLD) return 'tachylalia';
  if (articulationRateSPS < BRADY_THRESHOLD) return 'bradylalia';
  return 'normal';
}

class MetricsGenerator {
  private t0 = Date.now();
  private articulationRateSPS = BASELINE_ARTICULATION_SPS;
  private pauseRatio = BASELINE_PAUSE_RATIO;
  private meanPitchHz = 180;
  private pitchVariabilityHz = 12;
  private loudnessDb = -20;
  private voiceActivityPercent = 62;
  private lastClassification: Classification = 'normal';
  private lastRate = BASELINE_ARTICULATION_SPS;
  private lastPitch = 180;
  private cumulativeSyllables = 0;
  private abnormalSince: number | null = null;
  private pendingRecoverySince: number | null = null;

  next(): MetricsFrame {
    // Occasionally drift toward an excursion so the classifier/feedback
    // panels have something to react to, then relax back to baseline.
    const excursionBias = Math.sin(Date.now() / 15000) * 1.1;

    this.articulationRateSPS = walk(this.articulationRateSPS + excursionBias * 0.02, 0.12, 1.5, 7.0);
    this.pauseRatio = walk(this.pauseRatio, 0.015, 0.05, 0.55);
    this.meanPitchHz = walk(this.meanPitchHz, 3, 90, 300);
    this.pitchVariabilityHz = walk(this.pitchVariabilityHz, 1, 3, 35);
    this.loudnessDb = walk(this.loudnessDb, 0.8, -38, -6);
    this.voiceActivityPercent = walk(this.voiceActivityPercent, 2.5, 15, 92);

    const classification = classify(this.articulationRateSPS);
    const triggerFeedback = classification !== 'normal' && classification !== this.lastClassification;
    this.lastClassification = classification;

    const rateDeviation = Math.abs(this.articulationRateSPS - BASELINE_ARTICULATION_SPS) / BASELINE_ARTICULATION_SPS;
    const pauseDeviation = Math.abs(this.pauseRatio - BASELINE_PAUSE_RATIO) / BASELINE_PAUSE_RATIO;
    const compositeScore = clamp(100 - rateDeviation * 70 - pauseDeviation * 30, 5, 99);
    const speechConsistency = clamp(1 - rateDeviation * 0.6 - pauseDeviation * 0.3, 0.05, 0.99);

    const elapsedSec = (Date.now() - this.t0) / 1000;
    const syllableDurationSec = clamp(1 / this.articulationRateSPS, 0.08, 0.6);
    const speechToPauseRatio = (1 - this.pauseRatio) / this.pauseRatio;

    // Decision-audit fields (Part B.6) -- sign-aligned so positive = tachy direction.
    const zRate = (this.articulationRateSPS - BASELINE_ARTICULATION_SPS) / BASELINE_ARTICULATION_STD;
    const zPause = (speechToPauseRatio - DEMO_CALIBRATION.baselinePauseRatio!) / BASELINE_PAUSE_RATIO_STD;
    const zSyll = -(syllableDurationSec - BASELINE_SYLLABLE_DURATION_SEC) / BASELINE_SYLLABLE_DURATION_STD;
    const compositeZ = Number((0.6 * zRate + 0.25 * zPause + 0.15 * zSyll).toFixed(3));

    const rateTrend = Number((this.articulationRateSPS - this.lastRate).toFixed(4));
    const meanPitchTrendHz = Number((this.meanPitchHz - this.lastPitch).toFixed(3));
    this.lastRate = this.articulationRateSPS;
    this.lastPitch = this.meanPitchHz;

    // ~0.65s per tick -> roughly one syllable's worth of cumulative count per tick, for a plausible-looking counter.
    this.cumulativeSyllables += Math.round(this.articulationRateSPS * 0.65 * (0.7 + Math.random() * 0.6));

    if (classification !== 'normal') {
      if (this.abnormalSince == null) this.abnormalSince = elapsedSec;
      this.pendingRecoverySince ??= elapsedSec;
    } else {
      this.abnormalSince = null;
    }
    const timeInAbnormalStateSec = this.abnormalSince != null ? Number((elapsedSec - this.abnormalSince).toFixed(2)) : 0;
    let recoveryTimeSec: number | null = null;
    if (classification === 'normal' && this.pendingRecoverySince != null) {
      recoveryTimeSec = Number((elapsedSec - this.pendingRecoverySince).toFixed(2));
      this.pendingRecoverySince = null;
    }

    return {
      sessionId: DEMO_SESSION_ID,
      ts: new Date().toISOString(),
      elapsedSec,
      articulationRateSPS: Number(this.articulationRateSPS.toFixed(3)),
      speechRateWPM: Number((this.articulationRateSPS * 131).toFixed(1)),
      pauseRatio: Number(this.pauseRatio.toFixed(3)),
      pauseFrequencyPerMin: Number((this.pauseRatio * 42).toFixed(1)),
      speechToPauseRatio: Number(speechToPauseRatio.toFixed(2)),
      averageSyllableDurationSec: Number(syllableDurationSec.toFixed(3)),
      interSyllableIntervalSec: Number((syllableDurationSec * 1.4).toFixed(3)),
      pauseDurationSec: Number((0.3 + this.pauseRatio * 0.4).toFixed(3)),
      interPausalUnitLengthSec: Number((1 / Math.max(0.1, this.pauseRatio)).toFixed(2)),
      meanPitchHz: Number(this.meanPitchHz.toFixed(1)),
      pitchVariabilityHz: Number(this.pitchVariabilityHz.toFixed(2)),
      loudnessDb: Number(this.loudnessDb.toFixed(2)),
      voiceActivityPercent: Number(this.voiceActivityPercent.toFixed(1)),
      speechConsistency: Number(speechConsistency.toFixed(3)),
      compositeScore: Number(compositeScore.toFixed(1)),
      classification,
      confidence: Number((0.65 + Math.random() * 0.33).toFixed(3)),
      triggerFeedback,
      feedbackReason: triggerFeedback ? classification : null,
      zRate: Number(zRate.toFixed(3)),
      zPause: Number(zPause.toFixed(3)),
      zSyll: Number(zSyll.toFixed(3)),
      compositeZ,
      sampleSufficient: true,
      wordsPerLast30Sec: Number(((this.articulationRateSPS * (1 - this.pauseRatio) * 30) / 1.4).toFixed(1)),
      totalSyllablesSession: this.cumulativeSyllables,
      totalWordsSession: Number((this.cumulativeSyllables / 1.4).toFixed(1)),
      rateTrend,
      timeInAbnormalStateSec,
      recoveryTimeSec,
      loudnessVariabilityDb: Number((1.5 + Math.random() * 2).toFixed(2)),
      meanPitchTrendHz,
    };
  }
}

/** Duck-types DashboardTransport against the same simulated stream every subscriber reads. */
class DemoTransport implements DashboardTransport {
  connected = true;
  private handlers = new Map<string, Set<TransportHandler>>();
  private generator = new MetricsGenerator();
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private startedFired = false;

  on(event: string, handler: TransportHandler) {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event)!.add(handler);
  }

  off(event: string, handler: TransportHandler) {
    this.handlers.get(event)?.delete(handler);
  }

  private fire(event: string, ...args: unknown[]) {
    this.handlers.get(event)?.forEach((h) => h(...args));
  }

  emit(event: string, payload?: unknown, ack?: (...args: unknown[]) => void) {
    if (event === 'dashboard:subscribeUser') {
      ack?.({ userId: (payload as { userId: string })?.userId });
      if (!this.startedFired) {
        this.startedFired = true;
        setTimeout(() => {
          this.fire('session:started', {
            sessionId: DEMO_SESSION_ID,
            userId: DEMO_USER.id,
            startedAt: new Date().toISOString(),
            disorderMode: 'tachylalia',
            demoMode: true,
          });
        }, 300);
      }
      return;
    }

    if (event === 'dashboard:subscribe') {
      ack?.({ sessionId: DEMO_SESSION_ID, status: 'active' });
      this.startStreaming();
      return;
    }

    if (event === 'dashboard:unsubscribe') {
      this.stopStreaming();
    }
  }

  private startStreaming() {
    if (this.intervalId) return;
    this.intervalId = setInterval(() => {
      const frame = this.generator.next();
      this.fire('metrics:update', frame);
      if (frame.triggerFeedback) {
        this.fire('feedback:logged', {
          sessionId: DEMO_SESSION_ID,
          reason: frame.feedbackReason,
          pattern: frame.feedbackReason === 'tachylalia' ? [80, 40, 80, 40, 80] : [300],
          ts: frame.ts,
        });
      }
    }, 650);
  }

  private stopStreaming() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  disconnect() {
    this.stopStreaming();
    this.handlers.clear();
  }
}

function makeDemoSession(): Session {
  const startedAt = new Date(Date.now() - 1000 * 60 * 4);
  return {
    _id: DEMO_SESSION_ID,
    userId: DEMO_USER.id,
    status: 'active',
    startedAt: startedAt.toISOString(),
    summary: {
      durationSec: 0,
      avgArticulationRateSPS: null,
      avgSpeechRateWPM: null,
      avgPauseRatio: null,
      tachylaliaEvents: 0,
      bradylaliaEvents: 0,
      normalRatio: null,
    },
    createdAt: startedAt.toISOString(),
    updatedAt: startedAt.toISOString(),
  };
}

function makePastSessions(): Session[] {
  const now = Date.now();
  const day = 1000 * 60 * 60 * 24;
  return Array.from({ length: 8 }, (_, i) => {
    const startedAt = new Date(now - day * (i + 1) - 1000 * 60 * 30);
    const durationSec = 300 + Math.round(Math.random() * 900);
    const endedAt = new Date(startedAt.getTime() + durationSec * 1000);
    const avgArticulationRateSPS = BASELINE_ARTICULATION_SPS + (Math.random() * 2 - 1) * 0.9;
    const tachylaliaEvents = Math.round(Math.random() * 4);
    const bradylaliaEvents = Math.round(Math.random() * 2);
    return {
      _id: `demo-session-hist-${i}`,
      userId: DEMO_USER.id,
      status: 'completed' as const,
      startedAt: startedAt.toISOString(),
      endedAt: endedAt.toISOString(),
      summary: {
        durationSec,
        avgArticulationRateSPS: Number(avgArticulationRateSPS.toFixed(2)),
        avgSpeechRateWPM: Number((avgArticulationRateSPS * 131).toFixed(1)),
        avgPauseRatio: Number((BASELINE_PAUSE_RATIO + (Math.random() * 0.2 - 0.1)).toFixed(3)),
        tachylaliaEvents,
        bradylaliaEvents,
        normalRatio: Number((0.6 + Math.random() * 0.35).toFixed(2)),
      },
      createdAt: startedAt.toISOString(),
      updatedAt: endedAt.toISOString(),
    };
  });
}

const DEMO_PAST_SESSIONS = makePastSessions();
const DEMO_ACTIVE_SESSION = makeDemoSession();

// Mirrors the real gateway's behavior of auto-generating a session's PDF
// report the moment it completes (sessionService.endSession) — every demo
// "completed" session already has one ready to download.
function makeReportForSession(session: Session): Report {
  const timestamp = session.endedAt ?? new Date().toISOString();
  return {
    _id: `demo-report-${session._id}`,
    userId: session.userId,
    authorId: session.userId,
    title: `Speech Session Report — ${new Date(session.startedAt).toLocaleDateString()}`,
    type: 'session',
    status: 'finalized',
    sessionIds: [session._id],
    analysisResultIds: [],
    generatedAt: timestamp,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

const DEMO_REPORTS = new Map<string, Report>(
  DEMO_PAST_SESSIONS.filter((s) => s.status === 'completed').map((s) => [s._id, makeReportForSession(s)])
);

function backfillMetrics(count: number): SpeechMetricDoc[] {
  const gen = new MetricsGenerator();
  const now = Date.now();
  return Array.from({ length: count }, (_, i) => {
    const frame = gen.next();
    return {
      _id: `demo-metric-${i}`,
      sessionId: DEMO_SESSION_ID,
      timestamp: new Date(now - (count - i) * 650).toISOString(),
      elapsedSec: frame.elapsedSec,
      articulationRateSPS: frame.articulationRateSPS,
      speechRateWPM: frame.speechRateWPM,
      pauseRatio: frame.pauseRatio,
      pauseFrequencyPerMin: frame.pauseFrequencyPerMin,
      speechToPauseRatio: frame.speechToPauseRatio,
      meanPitchHz: frame.meanPitchHz,
      pitchVariabilityHz: frame.pitchVariabilityHz,
      loudnessDb: frame.loudnessDb,
      voiceActivityPercent: frame.voiceActivityPercent,
      speechConsistency: frame.speechConsistency,
      compositeScore: frame.compositeScore,
      classification: frame.classification,
      confidence: frame.confidence,
      zRate: frame.zRate,
      zPause: frame.zPause,
      zSyll: frame.zSyll,
      compositeZ: frame.compositeZ,
      sampleSufficient: frame.sampleSufficient,
      wordsPerLast30Sec: frame.wordsPerLast30Sec,
      totalSyllablesSession: frame.totalSyllablesSession,
      totalWordsSession: frame.totalWordsSession,
      rateTrend: frame.rateTrend,
      timeInAbnormalStateSec: frame.timeInAbnormalStateSec,
      recoveryTimeSec: frame.recoveryTimeSec,
      loudnessVariabilityDb: frame.loudnessVariabilityDb,
      meanPitchTrendHz: frame.meanPitchTrendHz,
    };
  });
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const demo = {
  user: DEMO_USER,
  activeSessionId: DEMO_SESSION_ID,

  async login() {
    await delay(350);
    return { user: DEMO_USER, accessToken: 'demo-access-token', refreshToken: 'demo-refresh-token' };
  },

  async me() {
    await delay(120);
    return DEMO_USER;
  },

  async listSessions(params: { status?: string; page?: number; limit?: number }): Promise<Paginated<Session>> {
    await delay(200);
    const everything = [DEMO_ACTIVE_SESSION, ...DEMO_PAST_SESSIONS];
    const all = params.status ? everything.filter((s) => s.status === params.status) : everything;
    const limit = params.limit ?? 20;
    const page = params.page ?? 1;
    const items = all.slice((page - 1) * limit, page * limit);
    return { items, total: all.length, page, limit, pages: Math.ceil(all.length / limit) || 1 };
  },

  async getSession(id: string): Promise<Session> {
    await delay(150);
    return [DEMO_ACTIVE_SESSION, ...DEMO_PAST_SESSIONS].find((s) => s._id === id) ?? DEMO_ACTIVE_SESSION;
  },

  async getSessionMetrics(_id: string, limit = 120): Promise<Paginated<SpeechMetricDoc>> {
    await delay(200);
    const items = backfillMetrics(limit);
    return { items, total: items.length, page: 1, limit, pages: 1 };
  },

  async getSessionEvents(_id: string): Promise<FeedbackEvent[]> {
    await delay(150);
    return [];
  },

  async getCalibration(_userId: string): Promise<CalibrationProfile> {
    await delay(150);
    return DEMO_CALIBRATION;
  },

  async getReportForSession(sessionId: string): Promise<Report | null> {
    await delay(150);
    return DEMO_REPORTS.get(sessionId) ?? null;
  },

  async generateSessionReport(sessionId: string): Promise<Report> {
    await delay(400);
    const session = [DEMO_ACTIVE_SESSION, ...DEMO_PAST_SESSIONS].find((s) => s._id === sessionId);
    const report = makeReportForSession(session ?? DEMO_ACTIVE_SESSION);
    DEMO_REPORTS.set(sessionId, report);
    return report;
  },

  async downloadReport(report: Report): Promise<void> {
    await delay(200);
    triggerBlobDownload(base64ToBlob(DEMO_REPORT_PDF_BASE64, 'application/pdf'), report.title);
  },

  createTransport(): DashboardTransport {
    return new DemoTransport();
  },
};
