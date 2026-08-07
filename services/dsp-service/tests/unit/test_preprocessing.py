import numpy as np
import pytest

from app.pipeline.preprocessing import (
    AudioPreprocessor,
    BandpassFilter,
    StreamingSpectralDenoiser,
    normalize_peak,
    pcm16_bytes_to_float32,
)
from tests.conftest import SAMPLE_RATE, silence, sine_burst


class TestPcm16BytesToFloat32:
    def test_decodes_known_values(self):
        # int16 extremes and a mid-range value, little-endian.
        raw = np.array([0, 32767, -32768, 16384], dtype="<i2").tobytes()
        out = pcm16_bytes_to_float32(raw)
        np.testing.assert_allclose(out, [0.0, 32767 / 32768.0, -1.0, 16384 / 32768.0], atol=1e-6)

    def test_empty_bytes_returns_empty_array(self):
        assert pcm16_bytes_to_float32(b"").size == 0

    def test_drops_stray_trailing_byte(self):
        raw = np.array([100, 200], dtype="<i2").tobytes() + b"\x01"
        out = pcm16_bytes_to_float32(raw)
        assert out.size == 2


class TestNormalizePeak:
    def test_scales_to_target_peak(self):
        x = np.array([0.1, -0.2, 0.05], dtype=np.float32)
        out = normalize_peak(x, target_peak=0.9)
        assert np.max(np.abs(out)) == pytest.approx(0.9, abs=1e-5)

    def test_silence_is_returned_unchanged(self):
        x = np.zeros(100, dtype=np.float32)
        out = normalize_peak(x)
        np.testing.assert_array_equal(out, x)

    def test_empty_input_does_not_raise(self):
        out = normalize_peak(np.zeros(0, dtype=np.float32))
        assert out.size == 0


class TestBandpassFilter:
    def test_output_same_length_as_input(self):
        bp = BandpassFilter(SAMPLE_RATE)
        x = sine_burst(0.2, freq_hz=150.0)
        y = bp.process(x)
        assert y.shape == x.shape
        assert y.dtype == np.float32

    def test_empty_chunk_returns_empty(self):
        bp = BandpassFilter(SAMPLE_RATE)
        assert bp.process(np.zeros(0, dtype=np.float32)).size == 0

    def test_attenuates_out_of_band_low_frequency(self):
        # 20Hz is well below BANDPASS_LOW_HZ (80Hz) — should be heavily attenuated.
        bp = BandpassFilter(SAMPLE_RATE)
        low = sine_burst(0.5, freq_hz=20.0, amplitude=1.0)
        out = bp.process(low)
        # Compare steady-state (post filter warm-up) RMS to the input RMS.
        tail_in = low[SAMPLE_RATE // 4 :]
        tail_out = out[SAMPLE_RATE // 4 :]
        rms_in = np.sqrt(np.mean(tail_in**2))
        rms_out = np.sqrt(np.mean(tail_out**2))
        assert rms_out < rms_in * 0.5

    def test_passes_in_band_frequency(self):
        # 150Hz is well within [80, 4000] — should pass through with modest attenuation.
        bp = BandpassFilter(SAMPLE_RATE)
        tone = sine_burst(0.5, freq_hz=150.0, amplitude=1.0)
        out = bp.process(tone)
        tail_in = tone[SAMPLE_RATE // 4 :]
        tail_out = out[SAMPLE_RATE // 4 :]
        rms_in = np.sqrt(np.mean(tail_in**2))
        rms_out = np.sqrt(np.mean(tail_out**2))
        assert rms_out > rms_in * 0.7

    def test_streaming_matches_one_shot_processing(self):
        """Filter state carried across chunks should produce (almost) the
        same output as processing the whole signal in one call — the
        streaming contract this class exists for."""
        x = sine_burst(0.3, freq_hz=150.0)

        one_shot = BandpassFilter(SAMPLE_RATE).process(x)

        streaming = BandpassFilter(SAMPLE_RATE)
        chunk_size = 256
        chunks = [streaming.process(x[i : i + chunk_size]) for i in range(0, len(x), chunk_size)]
        streamed = np.concatenate(chunks)

        np.testing.assert_allclose(streamed, one_shot, atol=1e-4)


class TestStreamingSpectralDenoiser:
    def test_short_chunk_buffers_without_output(self):
        den = StreamingSpectralDenoiser()
        out = den.process(np.zeros(10, dtype=np.float32))
        assert out.size == 0

    def test_produces_output_once_enough_samples_buffered(self):
        den = StreamingSpectralDenoiser()
        x = sine_burst(0.5, freq_hz=150.0)
        out = den.process(x)
        assert out.size > 0
        assert out.dtype == np.float32

    def test_agc_pulls_signal_rms_toward_target(self):
        den = StreamingSpectralDenoiser()
        # Establish a near-silent noise floor first so the subsequent tone
        # reads as signal rather than as more of the same "noise".
        den.process(silence(0.5))
        tone = sine_burst(1.0, freq_hz=150.0, amplitude=0.05)
        out = den.process(tone)
        assert out.size > 0
        tail = out[len(out) // 2 :]
        rms_out = float(np.sqrt(np.mean(tail**2)))
        rms_in = float(np.sqrt(np.mean(tone**2)))
        # AGC_TARGET_RMS is 0.1 — output should have moved well above the
        # tone's own ~0.035 raw RMS, toward that target.
        assert rms_out > rms_in * 1.5


class TestAudioPreprocessor:
    def test_process_returns_float32_array(self):
        pre = AudioPreprocessor(SAMPLE_RATE)
        x = sine_burst(0.5, freq_hz=150.0)
        out = pre.process(x)
        assert isinstance(out, np.ndarray)
        assert out.dtype == np.float32
