import numpy as np

from app.pipeline.vad import VoiceActivityDetector, _zero_crossing_rate
from tests.conftest import SAMPLE_RATE, silence, sine_burst


class TestZeroCrossingRate:
    def test_constant_signal_has_zero_crossings(self):
        assert _zero_crossing_rate(np.ones(10, dtype=np.float32)) == 0.0

    def test_alternating_signal_has_max_crossings(self):
        frame = np.array([1, -1, 1, -1, 1, -1], dtype=np.float32)
        assert _zero_crossing_rate(frame) == 1.0

    def test_short_frame_returns_zero(self):
        assert _zero_crossing_rate(np.array([1.0], dtype=np.float32)) == 0.0


class TestVoiceActivityDetector:
    def test_silence_never_confirms_speech(self):
        vad = VoiceActivityDetector(SAMPLE_RATE)
        decisions = vad.process(silence(1.0))
        assert len(decisions) > 0
        assert all(not d.is_speech for d in decisions)

    def test_loud_tone_after_silence_is_detected_as_speech(self):
        vad = VoiceActivityDetector(SAMPLE_RATE)
        # Establish a quiet noise floor first, then a clearly louder tone.
        vad.process(silence(1.0))
        decisions = vad.process(sine_burst(0.5, freq_hz=150.0, amplitude=0.8))
        assert any(d.is_speech for d in decisions)

    def test_onset_requires_consecutive_frames(self):
        """The very first frame carrying raw speech energy only starts the
        onset counter — VAD_ONSET_FRAMES (2) consecutive raw-speech frames
        are required before the detector actually confirms speech."""
        vad = VoiceActivityDetector(SAMPLE_RATE)
        vad.process(silence(1.0))
        decisions = vad.process(sine_burst(0.3, freq_hz=150.0, amplitude=0.8))
        assert decisions[0].is_speech is False
        assert any(d.is_speech for d in decisions)

    def test_hop_seconds_matches_configured_hop(self):
        vad = VoiceActivityDetector(SAMPLE_RATE)
        assert vad.hop_seconds == vad.hop_len / SAMPLE_RATE

    def test_streaming_across_chunks_matches_single_call(self):
        vad_single = VoiceActivityDetector(SAMPLE_RATE)
        x = np.concatenate([silence(0.5), sine_burst(0.3, 150.0, amplitude=0.8), silence(0.5)])
        single_decisions = vad_single.process(x)

        vad_stream = VoiceActivityDetector(SAMPLE_RATE)
        chunk = 320
        streamed_decisions = []
        for i in range(0, len(x), chunk):
            streamed_decisions.extend(vad_stream.process(x[i : i + chunk]))

        assert len(single_decisions) == len(streamed_decisions)
        assert [d.is_speech for d in single_decisions] == [d.is_speech for d in streamed_decisions]
