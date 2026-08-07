"""Energy + zero-crossing-rate voice activity detection.

Frames the continuous (already bandpassed + denoised + normalized) audio
stream at 20ms/10ms hop, tracks an adaptive noise floor from the quietest
recent frames, and applies onset/hangover debouncing so single noisy frames
can't flip the detector — a standard VAD design (see e.g. Sohn et al.,
"A Statistically Based Voice Activity Detector") without pulling in a heavy
external VAD dependency.
"""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass

import numpy as np

from app.pipeline import constants as C


@dataclass(frozen=True)
class FrameDecision:
    time: float  # seconds, start of frame within the session's audio timeline
    is_speech: bool
    energy_db: float


def _zero_crossing_rate(frame: np.ndarray) -> float:
    if len(frame) < 2:
        return 0.0
    signs = np.sign(frame)
    signs[signs == 0] = 1
    crossings = np.sum(signs[1:] != signs[:-1])
    return float(crossings) / (len(frame) - 1)


class VoiceActivityDetector:
    def __init__(self, sample_rate: int) -> None:
        self.sample_rate = sample_rate
        self.frame_len = int(sample_rate * C.VAD_FRAME_MS / 1000)
        self.hop_len = int(sample_rate * C.VAD_HOP_MS / 1000)

        self._tail = np.zeros(0, dtype=np.float32)
        self._samples_consumed = 0

        history_len = max(5, int(C.VAD_NOISE_FLOOR_WINDOW_SEC * 1000 / C.VAD_HOP_MS))
        self._quiet_energy_history: deque[float] = deque(maxlen=history_len)

        self._confirmed_speech = False
        self._onset_counter = 0
        self._hangover_counter = 0

    def process(self, chunk: np.ndarray) -> list[FrameDecision]:
        if chunk.size:
            self._tail = np.concatenate([self._tail, chunk.astype(np.float32)])

        decisions: list[FrameDecision] = []

        while len(self._tail) >= self.frame_len:
            frame = self._tail[: self.frame_len]
            frame_time = self._samples_consumed / self.sample_rate
            self._tail = self._tail[self.hop_len :]
            self._samples_consumed += self.hop_len

            rms = float(np.sqrt(np.mean(frame**2)))
            energy_db = 20.0 * np.log10(rms + C.EPS)
            zcr = _zero_crossing_rate(frame)

            if len(self._quiet_energy_history) >= 5:
                noise_floor_db = float(np.percentile(self._quiet_energy_history, C.VAD_NOISE_FLOOR_PERCENTILE))
            else:
                # Bootstrap: assume the very first frames are non-speech room
                # tone until we've accumulated enough history to estimate a
                # real floor.
                noise_floor_db = energy_db - C.VAD_ENERGY_MARGIN_DB

            raw_speech = (energy_db > noise_floor_db + C.VAD_ENERGY_MARGIN_DB) and (zcr <= C.VAD_ZCR_MAX)

            if not raw_speech:
                self._quiet_energy_history.append(energy_db)

            if self._confirmed_speech:
                if raw_speech:
                    self._hangover_counter = 0
                else:
                    self._hangover_counter += 1
                    if self._hangover_counter >= C.VAD_HANGOVER_FRAMES:
                        self._confirmed_speech = False
                        self._onset_counter = 0
            else:
                if raw_speech:
                    self._onset_counter += 1
                    if self._onset_counter >= C.VAD_ONSET_FRAMES:
                        self._confirmed_speech = True
                        self._hangover_counter = 0
                else:
                    self._onset_counter = 0

            decisions.append(FrameDecision(time=frame_time, is_speech=self._confirmed_speech, energy_db=energy_db))

        return decisions

    @property
    def hop_seconds(self) -> float:
        return self.hop_len / self.sample_rate
