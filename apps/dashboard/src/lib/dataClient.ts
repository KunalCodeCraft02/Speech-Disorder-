import { api, tokenStore } from './api';
import { createDashboardSocket } from './socket';
import { demo } from './demo';
import { triggerBlobDownload } from './downloadFile';
import type { DashboardTransport } from './transport';
import type {
  ApiEnvelope,
  CalibrationProfile,
  FeedbackEvent,
  Paginated,
  Report,
  Session,
  SessionStatus,
  SpeechMetricDoc,
  User,
} from '../types';

export const DEMO_MODE = import.meta.env.VITE_DEMO_MODE !== 'false';

export interface DataClient {
  demoMode: boolean;
  login(email: string, password: string): Promise<{ user: User; accessToken: string; refreshToken: string }>;
  me(): Promise<User>;
  listSessions(params: { status?: SessionStatus; page?: number; limit?: number }): Promise<Paginated<Session>>;
  getSession(id: string): Promise<Session>;
  getSessionMetrics(id: string, limit?: number): Promise<Paginated<SpeechMetricDoc>>;
  getSessionEvents(id: string): Promise<FeedbackEvent[]>;
  getCalibration(userId: string): Promise<CalibrationProfile>;
  /** The report for a session, if one has been generated yet (null otherwise). */
  getReportForSession(sessionId: string): Promise<Report | null>;
  /** Clinician/admin only server-side — generates or regenerates a session's PDF report. */
  generateSessionReport(sessionId: string): Promise<Report>;
  /** Fetches the PDF and triggers a browser download/save-as. */
  downloadReport(report: Report): Promise<void>;
  createTransport(accessToken: string): DashboardTransport;
  /** Only meaningful in demo mode — the id of the always-on simulated live session. */
  demoActiveSessionId?: string;
}

const realClient: DataClient = {
  demoMode: false,

  async login(email, password) {
    const res = await api.post<ApiEnvelope<{ user: User; accessToken: string; refreshToken: string }>>(
      '/auth/login',
      { email, password }
    );
    return res.data.data;
  },

  async me() {
    const res = await api.get<ApiEnvelope<User>>('/users/me');
    return res.data.data;
  },

  async listSessions(params) {
    const res = await api.get<ApiEnvelope<Paginated<Session>>>('/sessions', { params });
    return res.data.data;
  },

  async getSession(id) {
    const res = await api.get<ApiEnvelope<Session>>(`/sessions/${id}`);
    return res.data.data;
  },

  async getSessionMetrics(id, limit = 200) {
    const res = await api.get<ApiEnvelope<Paginated<SpeechMetricDoc>>>(`/sessions/${id}/metrics`, {
      params: { limit },
    });
    return res.data.data;
  },

  async getSessionEvents(id) {
    const res = await api.get<ApiEnvelope<FeedbackEvent[]>>(`/sessions/${id}/events`);
    return res.data.data;
  },

  async getCalibration(userId) {
    const res = await api.get<ApiEnvelope<CalibrationProfile>>(`/users/${userId}/calibration`);
    return res.data.data;
  },

  async getReportForSession(sessionId) {
    const res = await api.get<ApiEnvelope<Paginated<Report>>>('/reports', { params: { sessionId, limit: 1 } });
    return res.data.data.items[0] ?? null;
  },

  async generateSessionReport(sessionId) {
    const res = await api.post<ApiEnvelope<Report>>(`/reports/sessions/${sessionId}/generate`, {});
    return res.data.data;
  },

  async downloadReport(report) {
    const res = await api.get<ArrayBuffer>(`/reports/${report._id}/download`, { responseType: 'arraybuffer' });
    triggerBlobDownload(new Blob([res.data], { type: 'application/pdf' }), report.title);
  },

  createTransport(accessToken) {
    return createDashboardSocket(accessToken);
  },
};

const demoClient: DataClient = {
  demoMode: true,
  demoActiveSessionId: demo.activeSessionId,
  login: () => demo.login(),
  me: () => demo.me(),
  listSessions: (params) => demo.listSessions(params),
  getSession: (id) => demo.getSession(id),
  getSessionMetrics: (id, limit) => demo.getSessionMetrics(id, limit),
  getSessionEvents: (id) => demo.getSessionEvents(id),
  getCalibration: (userId) => demo.getCalibration(userId),
  getReportForSession: (sessionId) => demo.getReportForSession(sessionId),
  generateSessionReport: (sessionId) => demo.generateSessionReport(sessionId),
  downloadReport: (report) => demo.downloadReport(report),
  createTransport: () => demo.createTransport(),
};

export const dataClient: DataClient = DEMO_MODE ? demoClient : realClient;

// Demo mode never hits POST /auth/refresh, but AuthContext still calls
// tokenStore on login — keep the two in sync so a reload doesn't 401-loop.
export { tokenStore };
