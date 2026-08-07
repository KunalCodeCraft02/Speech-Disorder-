import numpy as np

from app.pipeline.pitch import PitchFrame, estimate_pitch_contour, voiced_f0_array, voiced_times_array
from tests.conftest import SAMPLE_RATE, silence, sine_burst


class TestEstimatePitchContour:
    def test_pure_tone_estimates_correct_f0(self):
        frames = estimate_pitch_contour(sine_burst(1.0, freq_hz=150.0, amplitude=0.8), SAMPLE_RATE)
        voiced = [f for f in frames if f.voiced]
        assert len(voiced) > 0
        f0s = np.array([f.f0_hz for f in voiced])
        # Autocorrelation pitch tracking on a clean tone should land close to
        # the true frequency (a couple Hz of quantization error is expected
        # since lag is integer-sample-resolution).
        assert np.median(np.abs(f0s - 150.0)) < 3.0

    def test_higher_frequency_tone_tracks_correctly(self):
        frames = estimate_pitch_contour(sine_burst(1.0, freq_hz=250.0, amplitude=0.8), SAMPLE_RATE)
        voiced = [f for f in frames if f.voiced]
        assert len(voiced) > 0
        f0s = np.array([f.f0_hz for f in voiced])
        assert np.median(np.abs(f0s - 250.0)) < 5.0

    def test_silence_is_unvoiced(self):
        frames = estimate_pitch_contour(silence(1.0), SAMPLE_RATE)
        assert len(frames) > 0
        assert all(not f.voiced and f.f0_hz is None for f in frames)

    def test_audio_shorter_than_one_frame_returns_empty(self):
        short = sine_burst(0.01, freq_hz=150.0)  # far shorter than PITCH_FRAME_MS (30ms)
        assert estimate_pitch_contour(short, SAMPLE_RATE) == []

    def test_start_time_offsets_frame_times(self):
        frames_a = estimate_pitch_contour(sine_burst(0.2, freq_hz=150.0), SAMPLE_RATE, start_time=0.0)
        frames_b = estimate_pitch_contour(sine_burst(0.2, freq_hz=150.0), SAMPLE_RATE, start_time=5.0)
        assert frames_b[0].time == frames_a[0].time + 5.0


class TestVoicedArrayHelpers:
    def test_voiced_times_array_filters_unvoiced(self):
        frames = [
            PitchFrame(time=0.0, f0_hz=150.0, voiced=True),
            PitchFrame(time=0.1, f0_hz=None, voiced=False),
            PitchFrame(time=0.2, f0_hz=160.0, voiced=True),
        ]
        np.testing.assert_array_equal(voiced_times_array(frames), [0.0, 0.2])

    def test_voiced_f0_array_filters_unvoiced(self):
        frames = [
            PitchFrame(time=0.0, f0_hz=150.0, voiced=True),
            PitchFrame(time=0.1, f0_hz=None, voiced=False),
            PitchFrame(time=0.2, f0_hz=160.0, voiced=True),
        ]
        np.testing.assert_array_equal(voiced_f0_array(frames), [150.0, 160.0])

    def test_empty_frame_list_returns_empty_arrays(self):
        assert voiced_times_array([]).size == 0
        assert voiced_f0_array([]).size == 0
