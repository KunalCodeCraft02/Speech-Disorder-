"""Syllable nuclei detection via intensity-contour peak-picking — the
De Jong & Wempe (2009) approach used in most Praat-based speech-rate
literature, reimplemented here in numpy: build a smoothed short-time
intensity (dB) contour, keep local maxima above a silence threshold, then
walk them in time order and reject any peak that doesn't dip far enough
from its neighbors to represent a genuinely distinct syllable onset.

A detected peak is additionally required to fall near a voiced pitch frame
(when voicing information is supplied), which rejects nuclei-shaped bursts
from fricatives/plosives or residual noise that the intensity contour alone
can't distinguish from a vowel nucleus.
"""

from __future__ import annotations

import numpy as np

from app.pipeline import constants as C


def _intensity_contour(audio: np.ndarray, sample_rate: int, start_time: float) -> tuple[np.ndarray, np.ndarray]:
    frame_len = int(sample_rate * C.NUCLEI_INTENSITY_FRAME_MS / 1000)
    hop_len = int(sample_rate * C.NUCLEI_INTENSITY_HOP_MS / 1000)

    if len(audio) < frame_len:
        return np.zeros(0), np.zeros(0)

    n_frames = 1 + (len(audio) - frame_len) // hop_len
    times = np.empty(n_frames)
    db = np.empty(n_frames)

    for i in range(n_frames):
        pos = i * hop_len
        frame = audio[pos : pos + frame_len]
        rms = float(np.sqrt(np.mean(frame**2)))
        db[i] = 20.0 * np.log10(rms + C.EPS)
        times[i] = start_time + (pos + frame_len / 2) / sample_rate

    smooth_frames = max(1, round(C.NUCLEI_SMOOTHING_MS / C.NUCLEI_INTENSITY_HOP_MS))
    if smooth_frames > 1:
        kernel = np.ones(smooth_frames) / smooth_frames
        db = np.convolve(db, kernel, mode="same")

    return times, db


def _local_maxima(db: np.ndarray, silence_threshold: float) -> list[int]:
    candidates = [
        i
        for i in range(1, len(db) - 1)
        if db[i] > silence_threshold and db[i] >= db[i - 1] and db[i] >= db[i + 1]
    ]

    # Collapse runs of adjacent equal-valued candidates (plateaus) into one.
    deduped: list[int] = []
    i = 0
    while i < len(candidates):
        j = i
        while j + 1 < len(candidates) and candidates[j + 1] - candidates[j] <= 2:
            j += 1
        group = candidates[i : j + 1]
        deduped.append(max(group, key=lambda k: db[k]))
        i = j + 1

    return deduped


def _apply_min_dip(candidates: list[int], db: np.ndarray, min_dip_db: float) -> list[int]:
    accepted: list[int] = []

    for idx in candidates:
        if not accepted:
            accepted.append(idx)
            continue

        prev = accepted[-1]
        valley = float(np.min(db[prev : idx + 1])) if idx > prev else float(db[idx])
        dip_from_prev = db[prev] - valley
        dip_from_curr = db[idx] - valley

        if dip_from_prev >= min_dip_db and dip_from_curr >= min_dip_db:
            accepted.append(idx)
        elif db[idx] > db[prev]:
            # Not enough dip to be a separate syllable, but this candidate
            # is more prominent than the one we'd already accepted —
            # replace it rather than keep the weaker peak.
            accepted[-1] = idx

    return accepted


def detect_syllable_nuclei(
    audio: np.ndarray,
    sample_rate: int,
    start_time: float = 0.0,
    voiced_times: np.ndarray | None = None,
    voicing_tolerance_sec: float = 0.02,
) -> list[float]:
    times, db = _intensity_contour(audio, sample_rate, start_time)
    if len(db) < 3:
        return []

    silence_threshold = float(np.max(db)) - C.NUCLEI_SILENCE_THRESHOLD_DB

    candidates = _local_maxima(db, silence_threshold)
    accepted = _apply_min_dip(candidates, db, C.NUCLEI_MIN_DIP_DB)
    nuclei_times = [float(times[i]) for i in accepted]

    if C.NUCLEI_REQUIRE_VOICING and voiced_times is not None and voiced_times.size > 0:
        nuclei_times = [t for t in nuclei_times if _near_voiced(t, voiced_times, voicing_tolerance_sec)]
    elif C.NUCLEI_REQUIRE_VOICING and voiced_times is not None and voiced_times.size == 0:
        nuclei_times = []

    return nuclei_times


def _near_voiced(t: float, voiced_times: np.ndarray, tolerance_sec: float) -> bool:
    idx = np.searchsorted(voiced_times, t)
    candidates = voiced_times[max(0, idx - 1) : idx + 1]
    if candidates.size == 0:
        return False
    return bool(np.min(np.abs(candidates - t)) <= tolerance_sec)
