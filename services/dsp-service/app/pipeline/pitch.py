"""Autocorrelation-based F0 (pitch) estimation.

Stateless by design — unlike VAD/segmentation, pitch is recomputed fresh
over the trailing analysis window on every pass (see session_pipeline.py),
since we only ever need window-level mean/variability statistics rather
than a deduplicated cumulative timeline.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from app.pipeline import constants as C


@dataclass(frozen=True)
class PitchFrame:
    time: float
    f0_hz: float | None
    voiced: bool


def estimate_pitch_contour(audio: np.ndarray, sample_rate: int, start_time: float = 0.0) -> list[PitchFrame]:
    frame_len = int(sample_rate * C.PITCH_FRAME_MS / 1000)
    hop_len = int(sample_rate * C.PITCH_HOP_MS / 1000)
    lag_min = max(1, int(sample_rate / C.PITCH_MAX_HZ))
    lag_max = int(sample_rate / C.PITCH_MIN_HZ)

    if len(audio) < frame_len:
        return []

    window = np.hanning(frame_len).astype(np.float32)
    fft_len = 1
    while fft_len < 2 * frame_len:
        fft_len *= 2

    frames: list[PitchFrame] = []
    pos = 0
    while pos + frame_len <= len(audio):
        frame = audio[pos : pos + frame_len]
        t = start_time + pos / sample_rate

        windowed = frame * window
        spectrum = np.fft.rfft(windowed, n=fft_len)
        autocorr = np.fft.irfft(spectrum * np.conj(spectrum), n=fft_len)[:frame_len]

        if autocorr[0] <= C.EPS or lag_max >= len(autocorr):
            frames.append(PitchFrame(t, None, False))
            pos += hop_len
            continue

        normalized = autocorr / autocorr[0]
        search_region = normalized[lag_min : lag_max + 1]

        if search_region.size == 0:
            frames.append(PitchFrame(t, None, False))
            pos += hop_len
            continue

        peak_offset = int(np.argmax(search_region))
        peak_value = float(search_region[peak_offset])
        lag = lag_min + peak_offset

        if peak_value >= C.PITCH_VOICING_THRESHOLD and lag > 0:
            f0 = sample_rate / lag
            frames.append(PitchFrame(t, float(f0), True))
        else:
            frames.append(PitchFrame(t, None, False))

        pos += hop_len

    return frames


def voiced_times_array(frames: list[PitchFrame]) -> np.ndarray:
    return np.array([f.time for f in frames if f.voiced], dtype=np.float64)


def voiced_f0_array(frames: list[PitchFrame]) -> np.ndarray:
    return np.array([f.f0_hz for f in frames if f.voiced], dtype=np.float64)
