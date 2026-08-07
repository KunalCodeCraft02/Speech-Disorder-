from app.pipeline import constants as C
from app.pipeline.segmentation import SegmentKind, SpeechSegmenter
from app.pipeline.vad import FrameDecision


def frames(pattern: list[bool], hop: float = 0.01, start: float = 0.0) -> list[FrameDecision]:
    return [FrameDecision(time=start + i * hop, is_speech=v, energy_db=-20.0 if v else -60.0) for i, v in enumerate(pattern)]


class TestSpeechSegmenter:
    def test_short_gap_is_merged_into_speech(self):
        """A silence run shorter than MIN_PAUSE_SEC should not split the
        speech segment — it's absorbed as part of one continuous IPU."""
        hop = 0.01
        gap_frames = int(0.1 / hop)  # 0.1s << MIN_PAUSE_SEC (0.3s)
        pattern = [True] * 20 + [False] * gap_frames + [True] * 20 + [False] * 40  # trailing real pause
        seg = SpeechSegmenter()
        segments = seg.process(frames(pattern, hop), hop)

        speech_segments = [s for s in segments if s.kind == SegmentKind.SPEECH]
        assert len(speech_segments) == 1
        # The merged segment spans from the start through the second speech run.
        assert speech_segments[0].start == 0.0

    def test_long_gap_splits_into_separate_speech_segments(self):
        hop = 0.01
        gap_frames = int(0.5 / hop)  # 0.5s >= MIN_PAUSE_SEC (0.3s)
        pattern = [True] * 20 + [False] * gap_frames + [True] * 20 + [False] * 40
        seg = SpeechSegmenter()
        segments = seg.process(frames(pattern, hop), hop)

        speech_segments = [s for s in segments if s.kind == SegmentKind.SPEECH]
        pause_segments = [s for s in segments if s.kind == SegmentKind.PAUSE]
        assert len(speech_segments) == 2
        assert len(pause_segments) == 1

    def test_leading_silence_shorter_than_min_pause_is_dropped(self):
        """A brief leading silence run that never reaches MIN_PAUSE_SEC
        before speech starts should not be reported as a pause segment."""
        hop = 0.01
        pattern = [False] * 5 + [True] * 30 + [False] * 40  # trailing real pause
        seg = SpeechSegmenter()
        segments = seg.process(frames(pattern, hop), hop)
        pause_segments = [s for s in segments if s.kind == SegmentKind.PAUSE]
        # Only the trailing (long) pause is reported — not the 5-frame lead-in.
        assert len(pause_segments) == 0  # trailing pause is still open, not yet finalized

    def test_open_segment_info_reflects_in_progress_segment(self):
        hop = 0.01
        pattern = [True] * 30
        seg = SpeechSegmenter()
        seg.process(frames(pattern, hop), hop)
        kind, start, end = seg.open_segment_info()
        assert kind == SegmentKind.SPEECH
        assert start == 0.0
        assert end == _last_frame_end(pattern, hop)


def _last_frame_end(pattern, hop):
    return (len(pattern) - 1) * hop + hop


class TestSegmentDuration:
    def test_duration_is_end_minus_start(self):
        from app.pipeline.segmentation import Segment

        s = Segment(kind=SegmentKind.SPEECH, start=1.0, end=2.5)
        assert s.duration == 1.5

    def test_duration_never_negative(self):
        from app.pipeline.segmentation import Segment

        s = Segment(kind=SegmentKind.SPEECH, start=2.0, end=1.0)
        assert s.duration == 0.0
