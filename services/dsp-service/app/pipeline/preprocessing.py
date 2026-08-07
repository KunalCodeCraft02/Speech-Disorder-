"""Streaming audio preprocessing: bandpass filter -> spectral-subtraction
noise reduction -> AGC normalization.

Both stages are implemented as true streaming, stateful processors — the
bandpass filter carries its IIR state (`zi`) across calls via
`scipy.signal.sosfilt`, and the denoiser is a real overlap-add (OLA)
short-time Fourier transform pipeline that carries both its input framing
tail and its output overlap buffer across calls. Neither stage reprocesses
audio it has already emitted, which keeps CPU cost proportional to the
incoming chunk size rather than the size of the rolling analysis window.
"""

from __future__ import annotations

from collections import deque

import numpy as np
from scipy.signal import butter, sosfilt, sosfilt_zi

from app.pipeline import constants as C


class BandpassFilter:
    """4th-order Butterworth bandpass, applied causally with persistent
    filter state so chunk boundaries introduce no discontinuity."""

    def __init__(
        self,
        sample_rate: int,
        low_hz: float = C.BANDPASS_LOW_HZ,
        high_hz: float = C.BANDPASS_HIGH_HZ,
        order: int = C.BANDPASS_ORDER,
    ) -> None:
        nyquist = sample_rate / 2.0
        low = low_hz / nyquist
        high = min(high_hz, nyquist * 0.99) / nyquist
        self.sos = butter(order, [low, high], btype="band", output="sos")
        self._zi = sosfilt_zi(self.sos) * 0.0

    def process(self, x: np.ndarray) -> np.ndarray:
        if x.size == 0:
            return x
        y, self._zi = sosfilt(self.sos, x, zi=self._zi)
        return y.astype(np.float32)


class StreamingSpectralDenoiser:
    """Overlap-add spectral subtraction (Boll, 1979) with an adaptive noise
    floor estimated from the quietest recent frames, followed by a
    frame-synchronous AGC normalization stage.

    Uses a Hann analysis *and* synthesis window at 50% hop, which satisfies
    the constant-overlap-add condition for both `sum(w)` and `sum(w^2)` —
    the standard "weighted overlap-add" configuration for spectral
    modification pipelines.
    """

    def __init__(
        self,
        frame_size: int = C.STFT_FRAME_SIZE,
        hop_size: int = C.STFT_HOP_SIZE,
    ) -> None:
        self.frame_size = frame_size
        self.hop_size = hop_size
        self.window = np.hanning(frame_size).astype(np.float32)

        self._input_tail = np.zeros(0, dtype=np.float32)
        self._output_overlap = np.zeros(0, dtype=np.float32)
        self._noise_mag: np.ndarray | None = None
        self._recent_frame_db: deque[float] = deque(maxlen=50)
        self._agc_gain = 1.0

    def _update_noise_estimate(self, mag: np.ndarray, frame_db: float) -> None:
        if self._noise_mag is None:
            self._noise_mag = mag.copy()
            self._recent_frame_db.append(frame_db)
            return

        if len(self._recent_frame_db) >= 5:
            quiet_threshold = float(np.percentile(self._recent_frame_db, C.NOISE_UPDATE_PERCENTILE))
        else:
            quiet_threshold = frame_db  # not enough history yet — treat this frame as the reference

        if frame_db <= quiet_threshold:
            alpha = C.NOISE_ESTIMATE_SMOOTHING
        else:
            alpha = 0.995  # slow leak so the estimate can still drift during long speech-only stretches

        self._noise_mag = alpha * self._noise_mag + (1 - alpha) * mag
        self._recent_frame_db.append(frame_db)

    def process(self, chunk: np.ndarray) -> np.ndarray:
        if chunk.size:
            self._input_tail = np.concatenate([self._input_tail, chunk.astype(np.float32)])

        ready_chunks: list[np.ndarray] = []

        while len(self._input_tail) >= self.frame_size:
            frame = self._input_tail[: self.frame_size]
            self._input_tail = self._input_tail[self.hop_size :]

            windowed = frame * self.window
            spectrum = np.fft.rfft(windowed)
            mag = np.abs(spectrum)
            phase = np.angle(spectrum)

            frame_db = 20.0 * np.log10(float(np.sqrt(np.mean(frame**2))) + C.EPS)
            self._update_noise_estimate(mag, frame_db)

            sub_mag = mag - C.NOISE_OVERSUBTRACTION_FACTOR * self._noise_mag
            floor = C.NOISE_SPECTRAL_FLOOR * mag
            sub_mag = np.maximum(sub_mag, floor)

            recon_spectrum = sub_mag * np.exp(1j * phase)
            recon_frame = np.fft.irfft(recon_spectrum, n=self.frame_size).astype(np.float32)

            frame_rms = float(np.sqrt(np.mean(recon_frame**2))) + C.EPS
            target_gain = float(np.clip(C.AGC_TARGET_RMS / frame_rms, C.AGC_MIN_GAIN, C.AGC_MAX_GAIN))
            self._agc_gain = C.AGC_SMOOTHING * self._agc_gain + (1 - C.AGC_SMOOTHING) * target_gain
            recon_frame = recon_frame * self._agc_gain

            synthesized = recon_frame * self.window

            out_len = max(len(self._output_overlap), self.frame_size)
            buf = np.zeros(out_len, dtype=np.float32)
            buf[: len(self._output_overlap)] = self._output_overlap
            buf[: self.frame_size] += synthesized

            ready_chunks.append(buf[: self.hop_size].copy())
            self._output_overlap = buf[self.hop_size :]

        if ready_chunks:
            return np.concatenate(ready_chunks)
        return np.zeros(0, dtype=np.float32)


class AudioPreprocessor:
    """Combines the bandpass filter and denoiser into the single per-chunk
    call site the session pipeline uses."""

    def __init__(self, sample_rate: int) -> None:
        self.bandpass = BandpassFilter(sample_rate)
        self.denoiser = StreamingSpectralDenoiser()

    def process(self, chunk: np.ndarray) -> np.ndarray:
        filtered = self.bandpass.process(chunk)
        return self.denoiser.process(filtered)


def pcm16_bytes_to_float32(raw: bytes) -> np.ndarray:
    """Decodes little-endian PCM16 mono bytes into float32 samples in [-1, 1]."""
    if len(raw) % 2 != 0:
        raw = raw[:-1]  # drop a stray trailing byte rather than fail the frame
    ints = np.frombuffer(raw, dtype="<i2")
    return (ints.astype(np.float32)) / 32768.0


def normalize_peak(x: np.ndarray, target_peak: float = 0.9) -> np.ndarray:
    """Simple one-shot peak normalization, used by the non-streaming
    calibration analysis path (see pipeline/session_pipeline.py:analyze_reference_sample)."""
    peak = float(np.max(np.abs(x))) if x.size else 0.0
    if peak < C.EPS:
        return x
    return (x * (target_peak / peak)).astype(np.float32)
