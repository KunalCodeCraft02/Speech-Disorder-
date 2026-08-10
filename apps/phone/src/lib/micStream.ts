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
// hardware, almost always because another app (a call, a voice
// assistant/hotword listener, a keyboard's voice-typing, another
// recorder) is holding it. That can also be transient -- the previous
// holder releasing the mic a few hundred ms after this app's own first
// failed attempt -- so the plain request gets a couple of short-backoff
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

export function isMicBusyError(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'NotReadableError';
}

/** Turns a getUserMedia() rejection into a message the patient can act on. */
export function describeMicError(err: unknown): string {
  if (err instanceof DOMException) {
    if (err.name === 'NotAllowedError') return 'Microphone permission denied';
    if (err.name === 'NotFoundError') return 'No microphone found on this device';
    if (err.name === 'NotReadableError') {
      return "Couldn't access the microphone — it may be in use by another app (a call, voice assistant, or recorder). Close it and try again.";
    }
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
      if (!isMicBusyError(err) || attempt === BUSY_RETRY_DELAYS_MS.length) throw err;
      await delay(BUSY_RETRY_DELAYS_MS[attempt]);
    }
  }
  throw lastErr;
}
