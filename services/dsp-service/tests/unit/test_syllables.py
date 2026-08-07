import numpy as np

from app.pipeline.syllables import _apply_min_dip, _local_maxima, detect_syllable_nuclei
from tests.conftest import SAMPLE_RATE, build_utterance, sine_burst


class TestLocalMaxima:
    def test_finds_single_peak(self):
        db = np.array([-40.0, -20.0, -5.0, -20.0, -40.0])
        assert _local_maxima(db, silence_threshold=-30.0) == [2]

    def test_ignores_peaks_below_threshold(self):
        db = np.array([-40.0, -35.0, -33.0, -35.0, -40.0])
        assert _local_maxima(db, silence_threshold=-10.0) == []

    def test_collapses_adjacent_plateau_into_one(self):
        db = np.array([-40.0, -10.0, -10.0, -10.0, -40.0])
        peaks = _local_maxima(db, silence_threshold=-30.0)
        assert len(peaks) == 1
        assert peaks[0] in (1, 2, 3)


class TestApplyMinDip:
    def test_two_well_separated_peaks_both_accepted(self):
        db = np.array([-40.0, -5.0, -40.0, -5.0, -40.0])
        accepted = _apply_min_dip([1, 3], db, min_dip_db=2.0)
        assert accepted == [1, 3]

    def test_shallow_dip_rejects_second_peak_of_equal_prominence(self):
        db = np.array([-40.0, -5.0, -5.5, -5.0, -40.0])
        accepted = _apply_min_dip([1, 3], db, min_dip_db=2.0)
        assert accepted == [1]

    def test_shallow_dip_replaces_with_more_prominent_peak(self):
        db = np.array([-40.0, -8.0, -8.5, -3.0, -40.0])
        accepted = _apply_min_dip([1, 3], db, min_dip_db=2.0)
        assert accepted == [3]

    def test_empty_candidates_returns_empty(self):
        assert _apply_min_dip([], np.zeros(5), min_dip_db=2.0) == []


class TestDetectSyllableNuclei:
    def test_too_short_audio_returns_empty(self):
        assert detect_syllable_nuclei(sine_burst(0.01), SAMPLE_RATE) == []

    def test_detects_expected_number_of_syllables(self):
        audio = build_utterance(n_syllables=4, syllable_sec=0.15, gap_sec=0.15)
        nuclei = detect_syllable_nuclei(audio, SAMPLE_RATE)
        # Peak-picking on synthetic bursts is not pixel-perfect, but should
        # land close to the number of bursts actually present.
        assert 3 <= len(nuclei) <= 5

    def test_nuclei_are_in_chronological_order(self):
        audio = build_utterance(n_syllables=5, syllable_sec=0.12, gap_sec=0.12)
        nuclei = detect_syllable_nuclei(audio, SAMPLE_RATE)
        assert nuclei == sorted(nuclei)

    def test_silence_yields_no_nuclei(self):
        from tests.conftest import silence

        assert detect_syllable_nuclei(silence(1.0), SAMPLE_RATE) == []

    def test_voicing_requirement_rejects_all_when_no_voiced_frames(self):
        audio = build_utterance(n_syllables=3, syllable_sec=0.15, gap_sec=0.15)
        nuclei = detect_syllable_nuclei(audio, SAMPLE_RATE, voiced_times=np.array([]))
        assert nuclei == []

    def test_voicing_requirement_keeps_nuclei_near_voiced_times(self):
        audio = build_utterance(n_syllables=3, syllable_sec=0.15, gap_sec=0.15)
        unfiltered = detect_syllable_nuclei(audio, SAMPLE_RATE)
        assert len(unfiltered) > 0
        # Voiced right at each detected nucleus — should keep them all.
        voiced_times = np.array(unfiltered)
        filtered = detect_syllable_nuclei(audio, SAMPLE_RATE, voiced_times=voiced_times)
        assert filtered == unfiltered
