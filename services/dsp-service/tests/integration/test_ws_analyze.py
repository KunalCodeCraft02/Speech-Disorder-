import json

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app.main import app
from app.session.registry import registry
from tests.conftest import build_utterance, float32_to_pcm16_bytes, silence

client = TestClient(app)


class TestWsAnalyzeProtocol:
    def test_metrics_frame_received_after_warmup(self):
        with client.websocket_connect("/ws/analyze/test-session-1") as ws:
            ws.send_text(json.dumps({"type": "init", "sessionId": "test-session-1", "calibration": None}))
            audio = build_utterance(n_syllables=6, syllable_sec=0.15, gap_sec=0.12, leading_silence_sec=0.2, trailing_silence_sec=0.5)
            ws.send_bytes(float32_to_pcm16_bytes(audio))
            frame = ws.receive_json()
            assert frame["type"] == "metrics"
            assert "articulationRateSPS" in frame
            assert "classification" in frame
        assert registry.get("test-session-1") is None

    def test_end_returns_summary(self):
        with client.websocket_connect("/ws/analyze/test-session-2") as ws:
            ws.send_text(json.dumps({"type": "init", "sessionId": "test-session-2"}))
            audio = build_utterance(n_syllables=4, syllable_sec=0.15, gap_sec=0.12)
            ws.send_bytes(float32_to_pcm16_bytes(audio))
            ws.receive_json()  # the metrics frame produced by the audio above

            ws.send_text(json.dumps({"type": "end"}))
            summary = ws.receive_json()
            assert summary["type"] == "summary"
            assert summary["sessionId"] == "test-session-2"
            assert "finalMetrics" in summary

    def test_end_before_init_returns_error(self):
        with client.websocket_connect("/ws/analyze/test-session-3") as ws:
            ws.send_text(json.dumps({"type": "end"}))
            err = ws.receive_json()
            assert err["type"] == "error"
            assert "not initialized" in err["message"]

    def test_audio_before_init_returns_error_then_connection_still_usable(self):
        with client.websocket_connect("/ws/analyze/test-session-4") as ws:
            ws.send_bytes(b"\x00\x00\x00\x00")
            err = ws.receive_json()
            assert err["type"] == "error"
            assert "before init" in err["message"]

            ws.send_text(json.dumps({"type": "init", "sessionId": "test-session-4"}))
            ws.send_bytes(float32_to_pcm16_bytes(silence(1.2)))
            frame = ws.receive_json()
            assert frame["type"] == "metrics"

    def test_malformed_json_returns_error_then_connection_still_usable(self):
        with client.websocket_connect("/ws/analyze/test-session-5") as ws:
            ws.send_text("not valid json {{{")
            err = ws.receive_json()
            assert err["type"] == "error"

            ws.send_text(json.dumps({"type": "init", "sessionId": "test-session-5"}))
            ws.send_text(json.dumps({"type": "end"}))
            summary = ws.receive_json()
            assert summary["type"] == "summary"

    def test_chunk_processing_failure_returns_error_and_keeps_connection_open(self, monkeypatch):
        """One bad/unprocessable chunk must not take the whole session down
        (see this module's docstring) — a raising pipeline should surface a
        non-fatal error frame, and the connection must still work afterward."""
        from app.pipeline.session_pipeline import SessionPipeline

        def boom(self, raw_pcm):
            raise ValueError("synthetic processing failure")

        monkeypatch.setattr(SessionPipeline, "process_chunk", boom)

        with client.websocket_connect("/ws/analyze/test-session-boom") as ws:
            ws.send_text(json.dumps({"type": "init", "sessionId": "test-session-boom"}))
            ws.send_bytes(b"\x01\x00\x02\x00")
            err = ws.receive_json()
            assert err["type"] == "error"
            assert "internal analysis error" in err["message"]

    def test_unknown_message_type_returns_error(self):
        with client.websocket_connect("/ws/analyze/test-session-6") as ws:
            ws.send_text(json.dumps({"type": "bogus"}))
            err = ws.receive_json()
            assert err["type"] == "error"
            assert "unknown control message type" in err["message"]

    def test_registry_cleans_up_after_disconnect(self):
        # `send_text`/`receive_json` cross a thread boundary in TestClient's
        # WS harness, so only the states either side of the `with` block —
        # before connecting and after it's fully torn down — are safe to
        # assert on without a race against the server's own processing.
        assert registry.get("test-session-7") is None
        with client.websocket_connect("/ws/analyze/test-session-7") as ws:
            ws.send_text(json.dumps({"type": "init", "sessionId": "test-session-7"}))
            ws.send_text(json.dumps({"type": "end"}))
            summary = ws.receive_json()
            assert summary["type"] == "summary"
        assert registry.get("test-session-7") is None


class TestWsAnalyzeCalibrationGating:
    def test_no_calibration_no_demo_mode_stays_uncalibrated(self):
        with client.websocket_connect("/ws/analyze/test-session-uncal") as ws:
            ws.send_text(json.dumps({"type": "init", "sessionId": "test-session-uncal", "calibration": None}))
            audio = build_utterance(n_syllables=6, syllable_sec=0.15, gap_sec=0.12, leading_silence_sec=0.2, trailing_silence_sec=0.5)
            ws.send_bytes(float32_to_pcm16_bytes(audio))
            frame = ws.receive_json()
            assert frame["classification"] == "uncalibrated"
            assert frame["triggerFeedback"] is False
            assert frame["confidence"] == 0.0

    def test_demo_mode_without_calibration_can_classify(self):
        with client.websocket_connect("/ws/analyze/test-session-demo") as ws:
            ws.send_text(
                json.dumps({"type": "init", "sessionId": "test-session-demo", "calibration": None, "demoMode": True})
            )
            ws.send_bytes(float32_to_pcm16_bytes(silence(1.2)))
            frame = ws.receive_json()
            assert frame["classification"] != "uncalibrated"

    def test_disorder_mode_threaded_through_to_pipeline(self):
        with client.websocket_connect("/ws/analyze/test-session-brady") as ws:
            ws.send_text(
                json.dumps({"type": "init", "sessionId": "test-session-brady", "calibration": None, "disorderMode": "bradylalia"})
            )
            ws.send_bytes(float32_to_pcm16_bytes(silence(1.2)))
            ws.receive_json()
            pipeline = registry.get("test-session-brady")
            assert pipeline is not None
            assert pipeline.disorder_mode.value == "bradylalia"
            ws.send_text(json.dumps({"type": "end"}))
            ws.receive_json()

    def test_new_fields_present_in_every_metrics_frame(self):
        with client.websocket_connect("/ws/analyze/test-session-fields") as ws:
            ws.send_text(
                json.dumps({"type": "init", "sessionId": "test-session-fields", "calibration": None, "demoMode": True})
            )
            audio = build_utterance(n_syllables=6, syllable_sec=0.15, gap_sec=0.12, leading_silence_sec=0.2, trailing_silence_sec=0.5)
            ws.send_bytes(float32_to_pcm16_bytes(audio))
            frame = ws.receive_json()
            for key in (
                "sampleSufficient",
                "zRate",
                "zPause",
                "zSyll",
                "compositeZ",
                "wordsPerLast30Sec",
                "totalSyllablesSession",
                "totalWordsSession",
                "loudnessVariabilityDb",
                "rateTrend",
                "meanPitchTrendHz",
                "timeInAbnormalStateSec",
                "recoveryTimeSec",
            ):
                assert key in frame, f"missing {key}"


class TestWsAnalyzeAuth:
    def test_missing_token_rejects_the_connection(self, reset_settings_cache, monkeypatch):
        monkeypatch.setenv("DSP_SERVICE_TOKEN", "secret123")
        with pytest.raises(WebSocketDisconnect):
            with client.websocket_connect("/ws/analyze/test-session-auth-missing"):
                pass

    def test_wrong_token_rejects_the_connection(self, reset_settings_cache, monkeypatch):
        monkeypatch.setenv("DSP_SERVICE_TOKEN", "secret123")
        with pytest.raises(WebSocketDisconnect):
            with client.websocket_connect(
                "/ws/analyze/test-session-auth-wrong", headers={"Authorization": "Bearer nope"}
            ):
                pass

    def test_correct_token_allows_the_connection(self, reset_settings_cache, monkeypatch):
        monkeypatch.setenv("DSP_SERVICE_TOKEN", "secret123")
        with client.websocket_connect(
            "/ws/analyze/test-session-auth-ok", headers={"Authorization": "Bearer secret123"}
        ) as ws:
            ws.send_text(json.dumps({"type": "init", "sessionId": "test-session-auth-ok"}))
            ws.send_text(json.dumps({"type": "end"}))
            summary = ws.receive_json()
            assert summary["type"] == "summary"
