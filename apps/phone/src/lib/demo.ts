import type { CalibrationClipUpload, CalibrationProfile, Classification, DisorderMode, User } from '../types';
import type { Transport, TransportHandler } from './transport';

/**
 * In-browser stand-in for services/gateway's /device and /dashboard
 * namespaces, so the record → classify → vibrate loop can be exercised
 * with zero backend running. Both demo transports below share one
 * `DemoEngine` instance so a classification change on the (simulated)
 * dashboard feed and a vibration command on the device feed are the same
 * event, exactly like the real gateway driving both from one DSP frame.
 */

const DEMO_USER: User = {
  id: 'demo-patient-0001',
  name: 'Demo Patient',
  email: 'demo@speechbio.local',
  role: 'patient',
  createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 30).toISOString(),
};

const DEMO_SESSION_ID = 'demo-session-phone-0001';
const BASELINE_RATE = 4.2;
const BASELINE_RATE_STD = 0.5;
const TACHY_Z = 2.0;
const BRADY_Z = 2.0;
const BASELINE_PITCH_HZ = 185;

// Keyed by disorderMode (Part E.12), not by classification reason -- a
// session only ever fires the one pattern matching the mode it opened in.
const VIBRATION_PATTERNS: Record<DisorderMode, number[]> = {
  tachylalia: [80, 60, 80, 60, 80],
  bradylalia: [300, 150, 300],
};

function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v));
}

type FrameListener = (frame: {
  classification: Classification;
  confidence: number;
  triggered: boolean;
  meanPitchHz: number;
  meanPitchTrendHz: number;
  articulationRateSPS: number;
}) => void;

class DemoEngine {
  sessionId = DEMO_SESSION_ID;
  private rate = BASELINE_RATE;
  private pitch = BASELINE_PITCH_HZ;
  private lastPitch = BASELINE_PITCH_HZ;
  private classification: Classification = 'normal';
  private timer: ReturnType<typeof setInterval> | null = null;
  private listeners = new Set<FrameListener>();
  private mode: DisorderMode = 'tachylalia';

  start(mode: DisorderMode) {
    this.mode = mode;
    if (this.timer) return;
    this.rate = BASELINE_RATE;
    this.pitch = BASELINE_PITCH_HZ;
    this.classification = 'normal';
    this.timer = setInterval(() => this.tick(), 700);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private tick() {
    const bias = Math.sin(Date.now() / 12000) * 0.9;
    this.rate = clamp(this.rate + (Math.random() * 2 - 1) * 0.18 + bias * 0.03, 1.2, 7.2);
    this.lastPitch = this.pitch;
    this.pitch = clamp(this.pitch + (Math.random() * 2 - 1) * 5, 90, 320);

    const z = (this.rate - BASELINE_RATE) / BASELINE_RATE_STD;
    // disorderMode scoping (Part B.8) -- only ever confirm the active direction.
    let next: Classification = 'normal';
    if (this.mode === 'tachylalia' && z > TACHY_Z) next = 'tachylalia';
    if (this.mode === 'bradylalia' && z < -BRADY_Z) next = 'bradylalia';

    const triggered = next !== 'normal' && next !== this.classification;
    this.classification = next;
    const confidence = 0.65 + Math.random() * 0.33;
    const meanPitchTrendHz = this.pitch - this.lastPitch;

    this.listeners.forEach((fn) =>
      fn({
        classification: next,
        confidence,
        triggered,
        meanPitchHz: this.pitch,
        meanPitchTrendHz,
        articulationRateSPS: this.rate,
      })
    );
  }

  subscribe(fn: FrameListener) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}

const engine = new DemoEngine();
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

class DemoDeviceTransport implements Transport {
  connected = true;
  private handlers = new Map<string, Set<TransportHandler>>();
  private unsubscribeEngine: (() => void) | null = null;

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
    if (event === 'session:start') {
      const { disorderMode, demoMode } = (payload as { disorderMode?: DisorderMode; demoMode?: boolean }) ?? {};
      const mode: DisorderMode = disorderMode === 'bradylalia' ? 'bradylalia' : 'tachylalia';
      const ackPayload = {
        sessionId: engine.sessionId,
        startedAt: new Date().toISOString(),
        disorderMode: mode,
        demoMode: Boolean(demoMode),
        calibrated: true,
      };
      engine.start(mode);
      this.unsubscribeEngine = engine.subscribe(({ classification, triggered }) => {
        if (triggered && classification !== 'normal') {
          this.fire('vibration:command', { pattern: VIBRATION_PATTERNS[mode], reason: classification });
        }
      });
      setTimeout(() => {
        this.fire('session:ack', ackPayload);
        ack?.(ackPayload);
      }, 250);
      return;
    }

    if (event === 'session:stop') {
      engine.stop();
      this.unsubscribeEngine?.();
      this.unsubscribeEngine = null;
      const ackPayload = { sessionId: engine.sessionId, summary: {} };
      setTimeout(() => ack?.(ackPayload), 150);
      return;
    }

    // audio:chunk / device:heartbeat: accepted and dropped, same as a
    // healthy connection with nothing surfaced back to the caller.
    void payload;
  }

  disconnect() {
    engine.stop();
    this.unsubscribeEngine?.();
    this.handlers.clear();
  }
}

class DemoDashboardTransport implements Transport {
  connected = true;
  private handlers = new Map<string, Set<TransportHandler>>();
  private unsubscribeEngine: (() => void) | null = null;

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
      return;
    }

    if (event === 'dashboard:subscribe') {
      ack?.({ sessionId: engine.sessionId, status: 'active' });
      this.unsubscribeEngine = engine.subscribe(({ classification, confidence, meanPitchHz, meanPitchTrendHz, articulationRateSPS }) => {
        this.fire('metrics:update', {
          sessionId: engine.sessionId,
          elapsedSec: null,
          articulationRateSPS,
          classification,
          confidence,
          meanPitchHz,
          meanPitchTrendHz,
          wordsPerLast30Sec: Number(((articulationRateSPS * 30) / 1.4).toFixed(1)),
          totalSyllablesSession: null,
          totalWordsSession: null,
          sampleSufficient: true,
        });
      });
      return;
    }

    if (event === 'dashboard:unsubscribe') {
      this.unsubscribeEngine?.();
      this.unsubscribeEngine = null;
    }
  }

  disconnect() {
    this.unsubscribeEngine?.();
    this.handlers.clear();
  }
}

export const demo = {
  activeSessionId: DEMO_SESSION_ID,

  async login() {
    await delay(350);
    return { user: DEMO_USER, accessToken: 'demo-access-token', refreshToken: 'demo-refresh-token' };
  },

  async me() {
    await delay(120);
    return DEMO_USER;
  },

  createDeviceTransport(): Transport {
    return new DemoDeviceTransport();
  },

  createDashboardTransport(): Transport {
    return new DemoDashboardTransport();
  },

  async getCalibration(): Promise<CalibrationProfile> {
    await delay(150);
    return {
      userId: DEMO_USER.id,
      baselineArticulationRate: BASELINE_RATE,
      baselineArticulationRateStd: BASELINE_RATE_STD,
      baselinePauseRatio: 1.5,
      baselinePauseRatioStd: 0.5,
      baselineSyllableDurationSec: 0.21,
      baselineSyllableDurationStd: 0.03,
      baselineIpuLengthSec: 1.1,
      baselineIpuLengthStd: 0.3,
      isPersonal: true,
      tachylaliaThreshold: Number((BASELINE_RATE * 1.55).toFixed(3)),
      bradylaliaThreshold: Number((BASELINE_RATE * 0.55).toFixed(3)),
      baselineSpeechRateWPM: Number((BASELINE_RATE * 131).toFixed(1)),
      baselinePitchHz: BASELINE_PITCH_HZ,
      baselineLoudnessDb: -19.8,
      baselinePauseDurationSec: 0.42,
      baselineSpeechRatio: 0.78,
      calibrationDurationSec: 40,
      calibrationSyllableCount: 168,
      calibratedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 3).toISOString(),
    };
  },

  /** Stands in for the FastAPI /calibrate pipeline's output on a plausible 2-clip reading. */
  async recordCalibration(clips: CalibrationClipUpload[]): Promise<CalibrationProfile> {
    await delay(900);
    const rate = 3.6 + Math.random() * 1.6; // 3.6-5.2 syll/s
    const pauseRatio = 0.14 + Math.random() * 0.14;
    return {
      userId: DEMO_USER.id,
      baselineArticulationRate: Number(rate.toFixed(3)),
      baselineArticulationRateStd: Number((0.3 + Math.random() * 0.3).toFixed(3)),
      baselinePauseRatio: Number(((1 - pauseRatio) / pauseRatio).toFixed(3)),
      baselinePauseRatioStd: Number((0.3 + Math.random() * 0.3).toFixed(3)),
      baselineSyllableDurationSec: Number((1 / rate).toFixed(3)),
      baselineSyllableDurationStd: Number((0.02 + Math.random() * 0.02).toFixed(3)),
      baselineIpuLengthSec: Number((0.8 + Math.random() * 0.6).toFixed(3)),
      baselineIpuLengthStd: Number((0.2 + Math.random() * 0.2).toFixed(3)),
      isPersonal: clips.length >= 2,
      tachylaliaThreshold: Number((rate * 1.55).toFixed(3)),
      bradylaliaThreshold: Number((rate * 0.55).toFixed(3)),
      baselineSpeechRateWPM: Number((rate * 131).toFixed(1)),
      baselinePitchHz: Number((150 + Math.random() * 80).toFixed(1)),
      baselineLoudnessDb: Number((-24 + Math.random() * 8).toFixed(2)),
      baselinePauseDurationSec: Number((0.3 + Math.random() * 0.4).toFixed(3)),
      baselineSpeechRatio: Number((1 - pauseRatio - 0.05).toFixed(3)),
      calibrationDurationSec: clips.length * 20,
      calibrationSyllableCount: Math.round(rate * clips.length * 20 * 0.7),
      calibratedAt: new Date().toISOString(),
    };
  },
};
