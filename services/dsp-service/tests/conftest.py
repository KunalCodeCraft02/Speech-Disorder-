"""Shared fixtures for the DSP service test suite.

Synthetic audio generators here stand in for real speech: a "voiced" burst
is a sine tone (which the autocorrelation pitch tracker and the intensity-
based syllable detector both treat like a vowel), separated by true silence
(zeros), which the VAD/segmenter treat like a pause. This lets pipeline
tests assert on structural behavior (N syllables detected, a pause boundary
found, F0 near the tone's frequency) without needing recorded audio fixtures.
"""

from __future__ import annotations

import numpy as np
import pytest

SAMPLE_RATE = 16000


def sine_burst(duration_sec: float, freq_hz: float = 150.0, sample_rate: int = SAMPLE_RATE, amplitude: float = 0.6) -> np.ndarray:
    n = int(duration_sec * sample_rate)
    t = np.arange(n) / sample_rate
    # A short raised-cosine envelope avoids a hard onset/offset click, which
    # would otherwise register as its own broadband "syllable-like" transient.
    envelope = np.ones(n, dtype=np.float64)
    ramp = max(1, int(0.01 * sample_rate))
    if n > 2 * ramp:
        envelope[:ramp] = np.linspace(0.0, 1.0, ramp)
        envelope[-ramp:] = np.linspace(1.0, 0.0, ramp)
    return (amplitude * envelope * np.sin(2 * np.pi * freq_hz * t)).astype(np.float32)


def silence(duration_sec: float, sample_rate: int = SAMPLE_RATE) -> np.ndarray:
    return np.zeros(int(duration_sec * sample_rate), dtype=np.float32)


def build_utterance(
    n_syllables: int = 4,
    syllable_sec: float = 0.15,
    gap_sec: float = 0.12,
    freq_hz: float = 150.0,
    sample_rate: int = SAMPLE_RATE,
    leading_silence_sec: float = 0.2,
    trailing_silence_sec: float = 0.5,
) -> np.ndarray:
    """A short "word" of `n_syllables` tone bursts separated by sub-pause gaps,
    padded with real silence at both ends (long enough to register as an
    actual pause, per MIN_PAUSE_SEC)."""
    parts = [silence(leading_silence_sec, sample_rate)]
    for i in range(n_syllables):
        parts.append(sine_burst(syllable_sec, freq_hz, sample_rate))
        if i < n_syllables - 1:
            parts.append(silence(gap_sec, sample_rate))
    parts.append(silence(trailing_silence_sec, sample_rate))
    return np.concatenate(parts).astype(np.float32)


def float32_to_pcm16_bytes(samples: np.ndarray) -> bytes:
    clipped = np.clip(samples, -1.0, 1.0)
    ints = (clipped * 32767.0).astype("<i2")
    return ints.tobytes()


@pytest.fixture
def reset_settings_cache():
    """Clears `get_settings`'s lru_cache before and after a test, so tests
    that monkeypatch env vars (e.g. DSP_SERVICE_TOKEN) see them take effect
    and don't leak into later tests."""
    from app.core.config import get_settings

    get_settings.cache_clear()
    yield
    get_settings.cache_clear()
