import { api, tokenStore } from './api';
import { createDashboardSocket, createDeviceSocket } from './socket';
import { demo } from './demo';
import type { Transport } from './transport';
import type { ApiEnvelope, CalibrationClipUpload, CalibrationProfile, User } from '../types';

export const DEMO_MODE = import.meta.env.VITE_DEMO_MODE !== 'false';

export interface DataClient {
  demoMode: boolean;
  login(email: string, password: string): Promise<{ user: User; accessToken: string; refreshToken: string }>;
  me(): Promise<User>;
  createDeviceTransport(accessToken: string): Transport;
  createDashboardTransport(accessToken: string): Transport;
  getCalibration(userId: string): Promise<CalibrationProfile | null>;
  /** Part A.4: pooled multi-clip calibration -- preferred over one longer clip. */
  recordCalibration(userId: string, clips: CalibrationClipUpload[]): Promise<CalibrationProfile>;
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

  createDeviceTransport: (accessToken) => createDeviceSocket(accessToken),
  createDashboardTransport: (accessToken) => createDashboardSocket(accessToken),

  async getCalibration(userId) {
    try {
      const res = await api.get<ApiEnvelope<CalibrationProfile>>(`/users/${userId}/calibration`);
      return res.data.data;
    } catch (err) {
      // 404 == uncalibrated (Part A.1) -- not an error state for the caller.
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status === 404) return null;
      throw err;
    }
  },

  async recordCalibration(userId, clips) {
    const res = await api.post<ApiEnvelope<CalibrationProfile>>(`/users/${userId}/calibration/record`, { clips });
    return res.data.data;
  },
};

const demoClient: DataClient = {
  demoMode: true,
  login: () => demo.login(),
  me: () => demo.me(),
  createDeviceTransport: () => demo.createDeviceTransport(),
  createDashboardTransport: () => demo.createDashboardTransport(),
  getCalibration: () => demo.getCalibration(),
  recordCalibration: (_userId, clips) => demo.recordCalibration(clips),
};

export const dataClient: DataClient = DEMO_MODE ? demoClient : realClient;
export { tokenStore };
