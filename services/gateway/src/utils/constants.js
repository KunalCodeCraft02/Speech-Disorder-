const ROLES = Object.freeze({
  PATIENT: 'patient',
  CLINICIAN: 'clinician',
  ADMIN: 'admin',
});

const DEVICE_TYPES = Object.freeze({
  PHONE: 'phone',
  DASHBOARD: 'dashboard',
});

const SESSION_STATUS = Object.freeze({
  ACTIVE: 'active',
  COMPLETED: 'completed',
  ABORTED: 'aborted',
});

const CLASSIFICATION = Object.freeze({
  UNCALIBRATED: 'uncalibrated',
  NORMAL: 'normal',
  TACHYLALIA: 'tachylalia',
  BRADYLALIA: 'bradylalia',
});

// Session-level selection (set once at session start, from the phone's
// landing page) — distinct from the per-frame `classification` above. A
// session opened in one mode can only ever confirm that single disorder
// direction plus NORMAL/UNCALIBRATED, never the other one.
const DISORDER_MODE = Object.freeze({
  TACHYLALIA: 'tachylalia',
  BRADYLALIA: 'bradylalia',
});

const FEEDBACK_TYPES = Object.freeze({
  VIBRATION: 'vibration',
});

// Vibration patterns are [vibrate, pause, vibrate, ...] in ms, consumed
// directly by navigator.vibrate() on the phone client. Keyed by
// disorderMode (not by per-frame classification reason) — a session only
// ever fires the one pattern matching the mode it was opened in.
const VIBRATION_PATTERNS = Object.freeze({
  [DISORDER_MODE.TACHYLALIA]: [80, 60, 80, 60, 80],
  [DISORDER_MODE.BRADYLALIA]: [300, 150, 300],
});

// Independent pitch/tone prosody cue (Part E.13) — must never reuse the
// main alert's pattern, so the two can never be confused for one another.
const PITCH_ALERT_VIBRATION_PATTERN = Object.freeze([50]);

const SOCKET_NAMESPACES = Object.freeze({
  DEVICE: '/device',
  DASHBOARD: '/dashboard',
});

const SOCKET_EVENTS = Object.freeze({
  // device namespace — phone -> server
  SESSION_START: 'session:start',
  AUDIO_CHUNK: 'audio:chunk',
  DEVICE_HEARTBEAT: 'device:heartbeat',
  SESSION_STOP: 'session:stop',

  // device namespace — server -> phone
  SESSION_ACK: 'session:ack',
  VIBRATION_COMMAND: 'vibration:command',
  SESSION_ERROR: 'session:error',

  // dashboard namespace — dashboard -> server
  DASHBOARD_SUBSCRIBE_USER: 'dashboard:subscribeUser',
  DASHBOARD_SUBSCRIBE_SESSION: 'dashboard:subscribe',
  DASHBOARD_UNSUBSCRIBE_SESSION: 'dashboard:unsubscribe',

  // dashboard namespace — server -> dashboard
  SESSION_STARTED: 'session:started',
  METRICS_UPDATE: 'metrics:update',
  FEEDBACK_LOGGED: 'feedback:logged',
  SESSION_ENDED: 'session:ended',
});

const ANALYSIS_TYPE = Object.freeze({
  REALTIME: 'realtime',
  SESSION_FINAL: 'session_final',
  PERIODIC: 'periodic',
});

const ANALYSIS_STATUS = Object.freeze({
  PENDING: 'pending',
  COMPLETED: 'completed',
  FAILED: 'failed',
});

const SEVERITY = Object.freeze({
  NONE: 'none',
  MILD: 'mild',
  MODERATE: 'moderate',
  SEVERE: 'severe',
});

const REPORT_TYPE = Object.freeze({
  SESSION: 'session',
  PROGRESS: 'progress',
  CALIBRATION: 'calibration',
});

const REPORT_STATUS = Object.freeze({
  DRAFT: 'draft',
  FINALIZED: 'finalized',
  ARCHIVED: 'archived',
});

const REPORT_FORMAT = Object.freeze({
  PDF: 'pdf',
  JSON: 'json',
  HTML: 'html',
});

const NOTIFICATION_TYPE = Object.freeze({
  SESSION_COMPLETED: 'session_completed',
  CALIBRATION_REMINDER: 'calibration_reminder',
  CALIBRATION_COMPLETED: 'calibration_completed',
  REPORT_READY: 'report_ready',
  TACHYLALIA_ALERT: 'tachylalia_alert',
  BRADYLALIA_ALERT: 'bradylalia_alert',
  CLINICIAN_MESSAGE: 'clinician_message',
  SYSTEM: 'system',
});

const NOTIFICATION_PRIORITY = Object.freeze({
  LOW: 'low',
  NORMAL: 'normal',
  HIGH: 'high',
});

const NOTIFICATION_CHANNEL = Object.freeze({
  IN_APP: 'in_app',
  PUSH: 'push',
  EMAIL: 'email',
});

const sessionRoom = (sessionId) => `session:${sessionId}`;
const userRoom = (userId) => `user:${userId}`;

module.exports = {
  ROLES,
  DEVICE_TYPES,
  SESSION_STATUS,
  CLASSIFICATION,
  DISORDER_MODE,
  FEEDBACK_TYPES,
  VIBRATION_PATTERNS,
  PITCH_ALERT_VIBRATION_PATTERN,
  SOCKET_NAMESPACES,
  SOCKET_EVENTS,
  ANALYSIS_TYPE,
  ANALYSIS_STATUS,
  SEVERITY,
  REPORT_TYPE,
  REPORT_STATUS,
  REPORT_FORMAT,
  NOTIFICATION_TYPE,
  NOTIFICATION_PRIORITY,
  NOTIFICATION_CHANNEL,
  sessionRoom,
  userRoom,
};
