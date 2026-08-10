// Some Android WebView audio HALs fail to open the microphone
// (NotReadableError -- "Could not start audio source") when
// echoCancellation/noiseSuppression/autoGainControl are requested
// together. Those constraints make Chromium open the mic via Android's
// voice-communication AudioSource and attach the platform's AEC/NS/AGC
// audio effects -- on stricter OEM audio HALs that request fails
// outright when there's no corresponding audio *output*, which is
// exactly this app's design (capture-only, never played back, so
// there's nothing for echo cancellation to reference).
//
// If even the simplest possible request (plain `audio: true`, no
// constraints at all) still fails with NotReadableError, the cause is
// no longer about constraints -- Android genuinely could not open the
// hardware. That can be transient (another app releasing the mic a
// few hundred ms later), so this gets a couple of short-backoff
// retries before giving up.
const IDEAL_CONSTRAINTS: MediaTrackConstraints = {
  channelCount: 1,
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
};

const MINIMAL_CONSTRAINTS: MediaTrackConstraints = { channelCount: 1 };

const BUSY_RETRY_DELAYS_MS = [300, 800];

function isRecoverable(err: unknown): boolean {
  return err instanceof DOMException && (err.name === 'NotReadableError' || err.name === 'OverconstrainedError');
}

function isMicBusyError(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'NotReadableError';
}

/**
 * Once every getUserMedia attempt has failed with NotReadableError,
 * enumerateDevices() tells us which of the two real causes we're
 * looking at:
 *  - No audioinput device listed at all (or a device with no label,
 *    which Chromium also blanks out under the same condition) usually
 *    means the OS-level microphone toggle (Android 12+'s system-wide
 *    Settings > Privacy > Microphone access switch) is off, or the mic
 *    is hard-blocked by policy -- no app can capture audio in that
 *    state, this one included, regardless of its own permission grant.
 *  - A labelled device IS listed, so the OS considers the mic
 *    present and accessible in principle; the open failure is then
 *    almost certainly another app holding it exclusively (a call,
 *    voice assistant/hotword listener, keyboard voice-typing, another
 *    recorder).
 */
async function hasUsableAudioInputDevice(): Promise<boolean> {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.some((d) => d.kind === 'audioinput');
  } catch {
    return true; // enumeration itself failing shouldn't override the real error with a misleading diagnosis
  }
}

export class MicUnavailableError extends Error {
  readonly deviceDetected: boolean;

  constructor(cause: unknown, deviceDetected: boolean) {
    super('Microphone unavailable');
    this.name = 'MicUnavailableError';
    this.cause = cause;
    this.deviceDetected = deviceDetected;
  }
}

/** Turns a getUserMedia() rejection into a message the patient can act on. */
export function describeMicError(err: unknown): string {
  if (err instanceof MicUnavailableError) {
    return err.deviceDetected
      ? "Couldn't access the microphone — it may be in use by another app (a call, voice assistant, or recorder). Close it and try again."
      : "No microphone is available — check that your phone's microphone access is turned on in Settings › Privacy, and that Speech Biofeedback has microphone permission in Settings › Apps.";
  }
  if (err instanceof DOMException) {
    if (err.name === 'NotAllowedError') return 'Microphone permission denied';
    if (err.name === 'NotFoundError') return 'No microphone found on this device';
  }
  return err instanceof Error ? err.message : 'Failed to access microphone';
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function openMicStream(): Promise<MediaStream> {
  try {
    return await navigator.mediaDevices.getUserMedia({ audio: IDEAL_CONSTRAINTS });
  } catch (err) {
    if (!isRecoverable(err)) throw err;
  }

  try {
    return await navigator.mediaDevices.getUserMedia({ audio: MINIMAL_CONSTRAINTS });
  } catch (err) {
    if (!isRecoverable(err)) throw err;
  }

  let lastErr: unknown;
  for (let attempt = 0; attempt <= BUSY_RETRY_DELAYS_MS.length; attempt++) {
    try {
      return await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      lastErr = err;
      if (!isMicBusyError(err)) throw err;
      if (attempt < BUSY_RETRY_DELAYS_MS.length) await delay(BUSY_RETRY_DELAYS_MS[attempt]);
    }
  }
  throw new MicUnavailableError(lastErr, await hasUsableAudioInputDevice());
}
