import base64

import pytest
from fastapi.testclient import TestClient

from app.core.config import get_settings
from app.main import app
from tests.conftest import SAMPLE_RATE, build_utterance, float32_to_pcm16_bytes

client = TestClient(app)


def _b64(samples) -> str:
    return base64.b64encode(float32_to_pcm16_bytes(samples)).decode()


class TestHealth:
    def test_health_ok(self):
        res = client.get("/health")
        assert res.status_code == 200
        body = res.json()
        assert body["status"] == "ok"
        assert isinstance(body["activeSessions"], int)
        assert body["version"]


class TestModelsVersionAuth:
    def test_no_token_configured_allows_access(self, reset_settings_cache):
        res = client.get("/models/version")
        assert res.status_code == 200
        body = res.json()
        assert body["sampleRate"] == SAMPLE_RATE
        assert body["pipelineVersion"]
        assert body["algorithm"]

    def test_token_configured_rejects_missing_auth(self, reset_settings_cache, monkeypatch):
        monkeypatch.setenv("DSP_SERVICE_TOKEN", "secret123")
        res = client.get("/models/version")
        assert res.status_code == 401

    def test_token_configured_rejects_wrong_token(self, reset_settings_cache, monkeypatch):
        monkeypatch.setenv("DSP_SERVICE_TOKEN", "secret123")
        res = client.get("/models/version", headers={"Authorization": "Bearer wrong"})
        assert res.status_code == 401

    def test_token_configured_accepts_correct_bearer(self, reset_settings_cache, monkeypatch):
        monkeypatch.setenv("DSP_SERVICE_TOKEN", "secret123")
        res = client.get("/models/version", headers={"Authorization": "Bearer secret123"})
        assert res.status_code == 200


class TestCalibrateUncalibratedGuard:
    def test_no_reference_stats_without_demo_mode_is_rejected(self):
        # Part A.1: the population default must never silently stand in for
        # a real, un-calibrated patient.
        res = client.post("/calibrate", json={"userId": "u1"})
        assert res.status_code == 422

    def test_no_reference_stats_with_demo_mode_returns_population_default(self):
        res = client.post("/calibrate", json={"userId": "u1", "demoMode": True})
        assert res.status_code == 200
        body = res.json()

        settings = get_settings()
        assert body["baselineArticulationRate"] == pytest.approx(settings.default_baseline_articulation_rate)
        assert body["isPersonal"] is False
        assert body["tachylaliaThreshold"] > body["baselineArticulationRate"]
        assert body["bradylaliaThreshold"] < body["baselineArticulationRate"]
        assert body["calibratedAt"]
        assert body["baselineSpeechRateWPM"] is None  # no audio sample was given


class TestCalibrateManualRate:
    def test_manual_articulation_rate_derives_thresholds(self):
        res = client.post(
            "/calibrate",
            json={"userId": "u1", "referenceStats": {"articulationRateSPS": 5.0, "pauseRatio": 1.6}},
        )
        assert res.status_code == 200
        body = res.json()
        assert body["baselineArticulationRate"] == 5.0
        assert body["baselinePauseRatio"] == 1.6
        assert body["isPersonal"] is False  # no audio -> no possible std


class TestCalibrateAudioSample:
    def test_audio_sample_returns_descriptive_stats(self, reset_settings_cache, monkeypatch):
        # Synthetic test utterances are sub-second; relax the real 20s
        # phonation gate so this exercises the happy path deterministically.
        monkeypatch.setenv("MIN_CALIBRATION_PHONATION_SEC", "0.3")
        utterance = build_utterance(
            n_syllables=6, syllable_sec=0.15, gap_sec=0.12, leading_silence_sec=0.1, trailing_silence_sec=0.3
        )
        res = client.post(
            "/calibrate",
            json={"userId": "u1", "referenceStats": {"audioBase64": _b64(utterance), "sampleRate": SAMPLE_RATE}},
        )
        assert res.status_code == 200
        body = res.json()
        assert body["baselineSpeechRateWPM"] is not None
        assert body["durationSec"] == pytest.approx(len(utterance) / SAMPLE_RATE, abs=0.05)
        assert body["syllableCount"] >= 1
        assert body["clipCount"] == 1
        assert isinstance(body["isPersonal"], bool)
        assert body["baselineArticulationRateStd"] >= 0

    def test_two_clips_are_pooled(self, reset_settings_cache, monkeypatch):
        monkeypatch.setenv("MIN_CALIBRATION_PHONATION_SEC", "0.3")
        clip_a = build_utterance(n_syllables=6, syllable_sec=0.15, gap_sec=0.12, leading_silence_sec=0.1, trailing_silence_sec=0.3)
        clip_b = build_utterance(n_syllables=5, syllable_sec=0.14, gap_sec=0.1, leading_silence_sec=0.1, trailing_silence_sec=0.3)

        res = client.post(
            "/calibrate",
            json={
                "userId": "u1",
                "referenceStats": {
                    "clips": [
                        {"audioBase64": _b64(clip_a), "sampleRate": SAMPLE_RATE},
                        {"audioBase64": _b64(clip_b), "sampleRate": SAMPLE_RATE},
                    ]
                },
            },
        )
        assert res.status_code == 200
        body = res.json()
        assert body["clipCount"] == 2
        assert body["syllableCount"] >= 2
        assert body["durationSec"] == pytest.approx((len(clip_a) + len(clip_b)) / SAMPLE_RATE, abs=0.05)

    def test_audio_sample_under_minimum_duration_returns_400(self):
        short = build_utterance(n_syllables=1, syllable_sec=0.05, gap_sec=0.0, leading_silence_sec=0.0, trailing_silence_sec=0.0)
        short = short[: int(0.3 * SAMPLE_RATE)]
        res = client.post("/calibrate", json={"userId": "u1", "referenceStats": {"audioBase64": _b64(short)}})
        assert res.status_code == 400

    def test_audio_sample_under_minimum_phonation_is_rejected(self):
        # Part A.3: real (default) 20s phonation minimum, not overridden --
        # a short synthetic utterance has nowhere near enough phonation.
        utterance = build_utterance(n_syllables=6, syllable_sec=0.15, gap_sec=0.12, leading_silence_sec=0.1, trailing_silence_sec=0.3)
        res = client.post(
            "/calibrate",
            json={"userId": "u1", "referenceStats": {"audioBase64": _b64(utterance), "sampleRate": SAMPLE_RATE}},
        )
        assert res.status_code == 422

    def test_invalid_base64_returns_400(self):
        res = client.post("/calibrate", json={"userId": "u1", "referenceStats": {"audioBase64": "not-valid-base64!!"}})
        assert res.status_code == 400


class TestCalibrateValidation:
    def test_missing_user_id_returns_422(self):
        res = client.post("/calibrate", json={})
        assert res.status_code == 422

    def test_requires_service_token_when_configured(self, reset_settings_cache, monkeypatch):
        monkeypatch.setenv("DSP_SERVICE_TOKEN", "secret123")
        res = client.post("/calibrate", json={"userId": "u1", "demoMode": True})
        assert res.status_code == 401

        res_ok = client.post(
            "/calibrate", json={"userId": "u1", "demoMode": True}, headers={"Authorization": "Bearer secret123"}
        )
        assert res_ok.status_code == 200
