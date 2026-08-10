// Some Android WebView audio HALs fail to open the microphone at all
// (NotReadableError -- "Could not start audio source") when
// echoCancellation/noiseSuppression/autoGainControl are requested
// together. Those constraints make Chromium open the mic via Android's
// voice-communication AudioSource and attach the platform's AEC/NS/AGC
// audio effects -- on stricter OEM audio HALs that request fails
// outright when there's no corresponding audio *output*, which is
// exactly this app's design (capture-only, never played back, so
// there's nothing for echo cancellation to reference). Retrying with
// progressively simpler constraints uses a different, more widely
// supported AudioSource and recovers capture on those devices instead
// of failing the whole session.
const IDEAL_CONSTRAINTS: MediaTrackConstraints = {
  channelCount: 1,
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
};

const MINIMAL_CONSTRAINTS: MediaTrackConstraints = { channelCount: 1 };

function isRecoverable(err: unknown): boolean {
  return err instanceof DOMException && (err.name === 'NotReadableError' || err.name === 'OverconstrainedError');
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

  return navigator.mediaDevices.getUserMedia({ audio: true });
}
