"""Turns a stream of VAD frame decisions into speech segments (IPUs —
inter-pausal units) and pause segments, merging silence runs shorter than
`MIN_PAUSE_SEC` into the surrounding speech (the standard clinical
definition of a pause boundary, e.g. De Jong & Wempe 2009, Trouvain 2004).

Runs as a streaming state machine: a segment is only finalized once the
audio that follows it proves it's actually over, so the caller never sees a
segment close prematurely. The currently-open segment's in-progress
duration is available via `open_segment_info()` for callers that need a
live (not-yet-finalized) estimate — e.g. cumulative voice-activity%.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum

from app.pipeline import constants as C
from app.pipeline.vad import FrameDecision


class SegmentKind(str, Enum):
    SPEECH = "speech"
    PAUSE = "pause"


@dataclass(frozen=True)
class Segment:
    kind: SegmentKind
    start: float
    end: float

    @property
    def duration(self) -> float:
        return max(0.0, self.end - self.start)


class SpeechSegmenter:
    def __init__(self, min_pause_sec: float = C.MIN_PAUSE_SEC) -> None:
        self.min_pause_sec = min_pause_sec

        self._state = SegmentKind.PAUSE
        self._state_start = 0.0

        # Only relevant while _state == SPEECH: tracks a candidate silence
        # run that hasn't yet reached min_pause_sec, so it can still be
        # absorbed back into the speech segment.
        self._silence_run_start: float | None = None
        self._silence_run_frames = 0

        self._last_frame_end = 0.0

    def process(self, decisions: list[FrameDecision], hop_seconds: float) -> list[Segment]:
        finalized: list[Segment] = []

        for d in decisions:
            frame_end = d.time + hop_seconds
            self._last_frame_end = frame_end

            if self._state == SegmentKind.SPEECH:
                if d.is_speech:
                    self._silence_run_frames = 0
                    self._silence_run_start = None
                else:
                    if self._silence_run_frames == 0:
                        self._silence_run_start = d.time
                    self._silence_run_frames += 1

                    candidate_duration = frame_end - self._silence_run_start
                    if candidate_duration >= self.min_pause_sec:
                        finalized.append(Segment(SegmentKind.SPEECH, self._state_start, self._silence_run_start))
                        self._state = SegmentKind.PAUSE
                        self._state_start = self._silence_run_start
                        self._silence_run_frames = 0
                        self._silence_run_start = None

            else:  # SegmentKind.PAUSE
                if d.is_speech:
                    pause_duration = d.time - self._state_start
                    if pause_duration >= self.min_pause_sec:
                        finalized.append(Segment(SegmentKind.PAUSE, self._state_start, d.time))
                    # else: the leading/inter-run silence was too short to
                    # count as a real pause on its own — drop it silently
                    # rather than record a degenerate sub-threshold pause.
                    self._state = SegmentKind.SPEECH
                    self._state_start = d.time

        return finalized

    def open_segment_info(self) -> tuple[SegmentKind, float, float]:
        """(kind, start, end) of the segment still in progress."""
        return self._state, self._state_start, max(self._state_start, self._last_frame_end)
