# DSP Service

FastAPI service that performs all speech-rate DSP and analysis for the biofeedback system — the gateway
never touches audio directly (see architecture §08). Receives streamed PCM16 audio over a per-session
WebSocket, returns real-time metrics and a Tachylalia/Bradylalia classification.

## Setup

```bash
python -m venv .venv
.venv\Scripts\activate        # Windows; use `source .venv/bin/activate` on macOS/Linux
pip install -r requirements.txt
cp .env.example .env
uvicorn app.main:app --reload --port 8000
```

Requires Python >= 3.11 (uses `X | None` union syntax and `dataclass` features throughout).

## Testing

```bash
pip install -r requirements-dev.txt
pytest                                          # full suite
pytest tests/unit                               # pipeline ("speech engine") unit tests only
pytest tests/integration                        # REST + WebSocket integration tests only
pytest --cov=app --cov-report=term-missing      # coverage summary in the terminal
pytest --cov=app --cov-report=html              # HTML report at htmlcov/index.html
```

`tests/unit/` exercises every pipeline stage in isolation — preprocessing (bandpass/denoiser/AGC), VAD,
segmentation, pitch tracking, syllable-nuclei detection, baseline derivation, the hysteresis classifier,
running-stats feature aggregation, and `SessionPipeline`'s warmup/emit-interval timing — using synthetic
sine-burst "utterances" (`tests/conftest.py`) instead of recorded audio fixtures. `tests/integration/`
drives the real FastAPI app via `TestClient`: `POST /calibrate` (including the audio-sample path) and the
full `/ws/analyze/{session_id}` protocol (init → metrics → end → summary, malformed input, auth, and a
mid-session processing failure that must not take the socket down).

## Pipeline

```
raw PCM16 chunk
  -> BandpassFilter            (80–4000 Hz, streaming Butterworth, IIR state carried across chunks)
  -> StreamingSpectralDenoiser (overlap-add STFT spectral subtraction + adaptive noise floor + AGC normalization)
  -> VoiceActivityDetector     (energy + zero-crossing-rate, adaptive noise floor, onset/hangover debouncing)
  -> SpeechSegmenter           (merges silence runs < 300ms into speech -> IPUs and pauses)
  -> SyllableNucleiDetector    (De Jong & Wempe intensity peak-picking, voicing-gated)
  -> PitchTracker               (autocorrelation F0, 75–400 Hz)
  -> FeatureExtractor           (all 13 requested metrics + composite score)
  -> BaselineProfile comparison -> HysteresisClassifier -> {normal, tachylalia, bradylalia}
```

Every stage above is a real, working implementation — see `app/pipeline/`. Two different memory
strategies are used deliberately (documented in `features.py`): rate features that drive live
classification (articulation rate, speech rate) are computed over a bounded trailing window for
responsiveness; descriptive rhythm features (pause stats, IPU length, voice activity%, consistency)
accumulate as O(1) running scalars over the whole session so memory never grows unbounded.

## WebSocket contract — `/ws/analyze/{session_id}`

Matches the gateway's `dspClient.js` exactly:

| Direction | Frame | Payload |
|---|---|---|
| Node -> here | text | `{"type": "init", "sessionId": ..., "calibration": {...} \| null}` |
| Node -> here | binary | raw PCM16 mono, `SAMPLE_RATE` Hz |
| Node -> here | text | `{"type": "end"}` — requests a final summary |
| here -> Node | text | `{"type": "metrics", ...}` — emitted roughly every `MIN_EMIT_INTERVAL_SEC` |
| here -> Node | text | `{"type": "summary", ...}` — reply to `end` |
| here -> Node | text | `{"type": "error", "message": ...}` — non-fatal, connection stays open |

A `metrics` frame carries every requested feature:

```json
{
  "type": "metrics",
  "ts": "2026-08-05T10:22:28.705Z",
  "elapsedSec": 12.4,
  "articulationRateSPS": 7.8,
  "speechRateWPM": 240.0,
  "averageSyllableDurationSec": 0.128,
  "interSyllableIntervalSec": 0.131,
  "pauseDurationSec": 0.42,
  "pauseFrequencyPerMin": 9.7,
  "speechToPauseRatio": 4.1,
  "interPausalUnitLengthSec": 2.3,
  "meanPitchHz": 178.4,
  "pitchVariabilityHz": 22.1,
  "loudnessDb": -18.6,
  "voiceActivityPercent": 71.2,
  "speechConsistency": 0.83,
  "compositeScore": 62.4,
  "classification": "tachylalia",
  "confidence": 0.87,
  "triggerFeedback": true,
  "feedbackReason": "tachylalia"
}
```

## REST API

| Endpoint | Method | Auth | Purpose |
|---|---|---|---|
| `/health` | GET | none | Liveness + active session count |
| `/models/version` | GET | bearer | Pipeline/algorithm version info |
| `/calibrate` | POST | bearer | Derive a baseline from a reference sample or a precomputed rate |

`POST /calibrate` accepts either a short base64 PCM16 reference recording (`referenceStats.audioBase64`,
analyzed with the same pipeline in a one-shot, non-streaming pass) or a precomputed
`referenceStats.articulationRateSPS`. Returns the same shape the gateway's `Profile` model stores.

Auth: every route except `/health` checks `Authorization: Bearer <DSP_SERVICE_TOKEN>` when
`DSP_SERVICE_TOKEN` is set. Left unset, the service accepts unauthenticated requests — fine for local
development, since in production it only ever sits on a private network segment reachable by the gateway
(architecture §10), but the token should still be set as defense in depth.

## Classification

Hysteresis state machine (`pipeline/classifier.py`): a deviation from `baseline.tachylaliaThreshold` /
`baseline.bradylaliaThreshold` must persist for `HYSTERESIS_WINDOWS` consecutive analysis passes before
the classification is confirmed. Once confirmed, `triggerFeedback` fires on the confirming window and
then again every `FEEDBACK_REFRACTORY_SEC` while the state stays abnormal — not on every window — so the
phone doesn't buzz continuously.

Baseline fields (`baselineArticulationRate`, `baselinePauseRatio`, `tachylaliaThreshold`,
`bradylaliaThreshold`) mirror the gateway's `Profile` model field-for-field; a session with no calibration
falls back to population defaults (`DEFAULT_BASELINE_ARTICULATION_RATE` etc. in `.env`).
