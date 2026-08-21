// TS wrapper for the native RecordingServicePlugin (see
// android/app/src/main/java/com/speechbiofeedback/app/{RecordingServicePlugin,RecordingForegroundService}.java).
// Item 7: starts/stops the Android foreground service that keeps mic
// access (and the process itself) alive while the app is backgrounded or
// the screen is locked. Native-only -- there is no background-execution
// concept to start on web/dev, so callers must check
// Capacitor.isNativePlatform() before touching this module (see
// useLiveSession.ts).

import { registerPlugin } from '@capacitor/core';

export interface RecordingServicePlugin {
  start(): Promise<void>;
  stop(): Promise<void>;
}

export const RecordingService = registerPlugin<RecordingServicePlugin>('RecordingService');
