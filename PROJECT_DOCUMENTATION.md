# Speech Biofeedback System — Project Documentation

**Real-time speech-rate disorder detection and biofeedback platform.** Captures a
patient's speech from a phone microphone, analyzes it with classical digital
signal processing (DSP) in real time, classifies it as **Normal**, **Tachylalia**
(pathologically fast/cluttered speech) or **Bradylalia** (pathologically slow
speech), and triggers immediate haptic (vibration) feedback on the phone —
while a clinician/patient dashboard watches the same session live and reviews
history afterward.

This document is an engineering-handoff reference: architecture, data flow,
every computed parameter and its formula, every tunable constant, the
classification decision logic, the data model, the tech stack, the
interfaces/APIs, known limitations, and a domain glossary.

> Repository layout: `apps/phone`, `apps/dashboard`, `services/gateway`,
> `services/dsp-service`. See also `services/dsp-service/CLASSIFICATION_ENGINE.md`
> for the most detailed, line-by-line reference on the DSP pipeline — this
> document summarizes and cross-references it rather than duplicating every
> derivation.

---

## Table of contents

1. [Overview](#1-overview)
2. [Problem statement](#2-problem-statement)
3. [Architecture](#3-architecture)
4. [Data flow](#4-data-flow)
5. [Output parameters (with formulas)](#5-output-parameters-with-formulas)
6. [Tunable constants / configuration](#6-tunable-constants--configuration)
7. [Decision logic (classification)](#7-decision-logic-classification)
8. [Data model / schema](#8-data-model--schema)
9. [Tech stack](#9-tech-stack)
10. [Interfaces / APIs](#10-interfaces--apis)
11. [Known limitations](#11-known-limitations)
12. [Validation & accuracy approach](#12-validation--accuracy-approach)
13. [Glossary](#13-glossary)

---

## 1. Overview

The system has four deployable components:

| Component | Path | Role |
|---|---|---|
| **Phone app** | `apps/phone` | Single-screen web app opened on the patient's phone. Captures mic audio, streams it to the gateway, vibrates on an abnormal classification. |
| **Dashboard app** | `apps/dashboard` | Clinician/patient web app. Watches a session live (gauges, waveform, trend graphs) and reviews session history, calibration, and PDF reports. |
| **Gateway** | `services/gateway` | Node.js/Express/Socket.IO service. Owns auth, session lifecycle, persistence (MongoDB), and real-time fan-out between phone, DSP service, and dashboard. |
| **DSP service** | `services/dsp-service` | Python/FastAPI service. Performs all audio signal processing and classification. Stateless REST + one WebSocket per active session. |

All four are independently deployable (see `render.yaml` — each ships as its
own Render service) and communicate only over the documented HTTP/WebSocket
contracts in [§10](#10-interfaces--apis); none share a database or in-process
state.

Both `apps/dashboard` and `apps/phone` ship with a **demo mode**
(`VITE_DEMO_MODE=true`, the default) that runs entirely against an in-browser
simulator emitting the same event names/payload shapes as the real backend —
useful for UI development and demos without standing up Mongo/Redis/FastAPI.

## 2. Problem statement

Tachylalia and bradylalia are speech-rate disorders — speaking pathologically
too fast or too slow relative to a person's own normal range, often with poor
rhythm/consistency. They're hard for a patient to self-monitor in the moment:
by the time a listener (or the patient themself) notices, the disordered
pattern may have already run for a while. Clinically, treatment relies on
practicing self-awareness and pacing, which benefits from **immediate,
objective, in-the-moment feedback** rather than only periodic clinician
observation.

This system addresses that by:
1. Measuring the patient's speech rate and rhythm continuously from a phone
   mic during everyday practice or exercises.
2. Comparing it, in real time, against **that patient's own calibrated
   baseline** (not a generic population norm) using a statistically
   principled z-score.
3. Buzzing the phone the moment a deviation is confirmed (with hysteresis to
   avoid false alarms on normal rate variation), so the patient can
   self-correct immediately.
4. Giving a clinician a live dashboard view plus historical session data,
   trend charts, and generated PDF reports to track progress over time.

It is explicitly **not** a diagnostic/ML system (see [§11](#11-known-limitations));
it's a deterministic DSP measurement + rule-based classifier intended as a
biofeedback aid alongside clinical judgment.

## 3. Architecture

```
                    ┌─────────────────────┐
                    │   Phone app (SPA)   │
                    │  apps/phone          │
                    │  - getUserMedia mic  │
                    │  - AudioWorklet →    │
                    │    16kHz PCM16       │
                    │  - navigator.vibrate │
                    └──────────┬───────────┘
                               │ Socket.IO  /device namespace
                               │ (JWT auth) — audio:chunk (binary),
                               │ session:start/stop, vibration:command
                               ▼
   ┌───────────────────────────────────────────────────────────────┐
   │                          Gateway                                │
   │                     services/gateway (Node/Express)             │
   │  - REST /api/v1  (auth, users, sessions, calibration,           │
   │    analysis-results, reports, notifications)                    │
   │  - Socket.IO: /device (phone), /dashboard (clinician/patient)   │
   │  - sessionManager.js: transport-agnostic orchestration,         │
   │    fan-out phone ⇄ DSP ⇄ dashboard                              │
   │  - MongoDB (Mongoose) persistence                                │
   │  - PDFKit report generation                                      │
   └───────┬───────────────────────────────────────────┬─────────────┘
           │ per-session WebSocket                       │ Socket.IO
           │ /ws/analyze/{sessionId}                     │ /dashboard namespace
           │ (bearer token)                              │ (JWT auth)
           ▼                                              ▼
 ┌──────────────────────────────┐            ┌──────────────────────────┐
 │        DSP service            │            │     Dashboard app (SPA)   │
 │  services/dsp-service          │            │     apps/dashboard        │
 │  (Python/FastAPI)              │            │  - live gauges, waveform, │
 │  - Preprocess → VAD →          │            │    trend graphs           │
 │    Segment → Pitch → Syllable  │            │  - session history,       │
 │    nuclei → Features →         │            │    calibration summary    │
 │    Baseline compare →          │            │  - report download        │
 │    Hysteresis classifier       │            └──────────────────────────┘
 │  - REST: /health,              │
 │    /models/version, /calibrate │
 └──────────────────────────────┘
                               ▲
                               │ MongoDB (persistence)
                     ┌─────────┴─────────┐
                     │      MongoDB       │
                     │ Users, Profiles,   │
                     │ Sessions, Speech-  │
                     │ Metrics (time-     │
                     │ series), Feedback- │
                     │ Events, Analysis-  │
                     │ Results, Reports,  │
                     │ Notifications      │
                     └────────────────────┘
```

**Key architectural decision:** the gateway never touches raw audio content
beyond forwarding bytes — all DSP/analysis logic lives in the Python service,
keeping the Node layer purely about orchestration, auth, and persistence. The
DSP service is stateless between sessions (per-session state lives in
`app/session/registry.py`, in-process, keyed by `sessionId`) and holds no
database connection of its own.

**Redis** is optional in the gateway — only required once more than one
gateway instance runs concurrently (Socket.IO horizontal scaling via
`@socket.io/redis-adapter`).

## 4. Data flow

### 4.1 Live session (audio → analysis → feedback)

1. Phone emits `session:start` (with `disorderMode`, one of `tachylalia` /
   `bradylalia`) → gateway creates a `Session` document, loads the caller's
   calibration `Profile`, and opens a per-session WebSocket to the DSP
   service (`services/dspClient.js`).
2. Phone streams binary `audio:chunk` frames (~250ms / 8000 bytes each,
   16kHz mono PCM16) → `sessionManager.recordAudioChunk` forwards them
   verbatim onto that WebSocket.
3. The DSP service accumulates chunks, runs its pipeline (§5) roughly every
   `MIN_EMIT_INTERVAL_SEC` (0.5s) over the trailing `ANALYSIS_WINDOW_SEC`
   (4s), and streams back a `metrics` frame.
4. `sessionManager` persists each frame as a `SpeechMetric` document; when a
   frame is flagged `triggerFeedback: true`, it also persists a
   `FeedbackEvent` and emits `vibration:command` to the originating phone
   socket.
5. Every `metrics` and `feedback` event is also broadcast to any `dashboard`
   sockets subscribed to that session's room (`session:<id>`).
6. `session:stop` (or a device disconnect, or an unrecoverable DSP failure)
   ends the session: computes the lightweight `Session.summary` aggregate,
   broadcasts `session:ended`, and — on a clean `completed` end, best-effort
   — generates the session's `AnalysisResult`, fires a `session_completed`
   `Notification`, and renders + stores the downloadable PDF `Report`
   (firing its own `report_ready` `Notification`).

This orchestration lives entirely in `services/sessionManager.js`, which is
transport-agnostic (emits plain Node events that `sockets/index.js` wires to
`io.emit()` calls) — the same code path handles a clean stop and a
crash-abort identically.

### 4.2 Calibration flow

1. Phone/dashboard records one or more short reference clips (preferably 2 ×
   ~20s) and `PUT`s them to the gateway's calibration endpoint, which
   forwards to the DSP service's `POST /calibrate`.
2. The DSP service analyzes each clip twice — a whole-clip pass (descriptive
   stats) and a per-4s-sub-window pass (feeds a personal mean + std for the
   z-score classifier) — pools all clips' sub-window samples, and rejects
   the attempt (`422`) if pooled phonation time is under
   `MIN_CALIBRATION_PHONATION_SEC` (20s).
3. The resulting baseline is written to the gateway's `Profile` document
   (both as the "active" flat baseline and appended to
   `calibrationHistory`, append-only — recalibrating never destroys prior
   history).
4. Every subsequent session for that user loads this baseline via the `init`
   WebSocket message so the DSP service can classify against it.

### 4.3 Historical/reporting flow

`GET /sessions/:id/metrics` paginates the persisted `SpeechMetric`
time-series for dashboard charts (backfilling on load, then the live socket
keeps the same rolling series growing — `useMergedSeries` in the dashboard).
A clinician can generate/regenerate a per-session PDF
(`POST /reports/sessions/:sessionId/generate`), which is stored as a
`Buffer` on the `Report` document and streamed back via
`GET /reports/:id/download`.

## 5. Output parameters (with formulas)

Computed in `services/dsp-service/app/pipeline/features.py`, emitted in every
`metrics` WebSocket frame. **Full formula derivations and the exact pipeline
stage each depends on are documented exhaustively in
`services/dsp-service/CLASSIFICATION_ENGINE.md` §3–4** — this table is the
condensed reference.

### 5.1 The 13 core features

| # | Field (wire name) | Formula | Meaning |
|---|---|---|---|
| 1 | `articulationRateSPS` | `syllables_in_window ÷ phonation_seconds_in_window` | **Primary classification signal.** Syllables/sec of actual talking (pauses excluded) |
| 2 | `speechRateWPM` | `(syllables_in_window ÷ window_seconds) × 60 ÷ 1.4` | Words/min including pauses (1.4 syll/word English approximation) |
| 3 | `averageSyllableDurationSec` | `phonation_seconds_in_window ÷ syllables_in_window` | Average length of one syllable |
| 4 | `interSyllableIntervalSec` | mean gap between consecutive syllable nuclei within the same IPU (session-to-date) | Rhythm |
| 5 | `pauseDurationSec` | mean length of all pauses so far this session | Typical pause length |
| 6 | `pauseFrequencyPerMin` | `total_pause_count ÷ (elapsed_seconds ÷ 60)` | Pause frequency |
| 7 | `speechToPauseRatio` | `total_speech_seconds ÷ total_pause_seconds` | Talking vs. silence balance |
| 8 | `interPausalUnitLengthSec` | `total_speech_seconds ÷ total_IPU_count` | Average length of a continuous speech run |
| 9 | `meanPitchHz` | mean F0 over voiced frames in the window | Average pitch |
| 10 | `pitchVariabilityHz` | std. dev. of F0 over voiced frames in the window | Monotone vs. expressive |
| 11 | `loudnessDb` | mean energy (dB) of speech frames in the window | Loudness |
| 12 | `voiceActivityPercent` | `100 × total_speech_seconds ÷ elapsed_seconds` | % of session spent talking |
| 13 | `speechConsistency` | `clip(1 − CV(inter-syllable intervals), 0, 1)`, CV = std/mean | Rhythmic steadiness (1.0 = perfectly even; defaults to 1.0 until enough samples exist) |

Two accumulation strategies are used deliberately: **rate features (#1–3)**
use only the trailing `ANALYSIS_WINDOW_SEC` (reacts quickly, drives
classification); **rhythm/descriptive features (#4–8, #12–13)** accumulate as
session-to-date running totals (O(1) memory, more stable); **pitch/loudness
(#9–11)** are recomputed fresh from the current window only.

### 5.2 Composite wellness score (0–100)

```
rate_closeness  = 1 − min(1, |articulation_rate − baseline_rate| ÷ baseline_rate)
activity_gap    = |voice_activity_ratio − 0.6| ÷ 0.6      # 0.6 = typical conversational speech:pause ratio
activity_score  = 1 − min(1, activity_gap)

composite_score = 100 × [0.5·rate_closeness + 0.3·speechConsistency + 0.2·activity_score]
```

A general quality/wellness indicator — **not** what drives the
Tachylalia/Bradylalia label (see §7). Shown only in a secondary/expandable
panel in the UIs.

### 5.3 Derived parameters (v2)

| Field | Formula | Meaning |
|---|---|---|
| `wordsPerLast30Sec` | nuclei in an independent trailing 30s ring buffer ÷ 1.4 | Own cadence, decoupled from the 4s classification window |
| `totalSyllablesSession` / `totalWordsSession` | session-cumulative nuclei / ÷1.4 | Monotonically non-decreasing |
| `rateTrend` | least-squares slope of `articulationRateSPS` over the last 4 windows vs. elapsed time | Positive = accelerating rate |
| `meanPitchTrendHz` | same, for `meanPitchHz` | Positive = rising pitch |
| `timeInAbnormalStateSec` | elapsed time since the confirmed state most recently became TACHYLALIA/BRADYLALIA | Resets to 0 when NORMAL is reconfirmed |
| `recoveryTimeSec` | elapsed time from a `triggerFeedback=true` event to the next confirmed NORMAL | Emitted once per recovery, else `null` |
| `loudnessVariabilityDb` | std. dev. of energy (dB) over speech frames in the window | Loudness steadiness |

### 5.4 Classifier-output fields (not features)

`classification`, `confidence`, `triggerFeedback`, `feedbackReason`,
`sampleSufficient`, `zRate`, `zPause`, `zSyll`, `compositeZ` — see [§7](#7-decision-logic-classification).

### 5.5 Session-level aggregates (gateway)

Computed at session end (`sessionService.computeAndPersistSummary`) and again
when an `AnalysisResult` is generated (`analysisResultService.js`), via a
MongoDB aggregation over that session's `SpeechMetric` documents:

| Field | Formula |
|---|---|
| `avgArticulationRateSPS` | mean of `articulationRateSPS` across all persisted metric frames |
| `avgSpeechRateWPM` / `avgPauseRatio` | same, mean across frames |
| `normalRatio` | `count(classification == normal) ÷ total_frames` |
| `tachylaliaEvents` / `bradylaliaEvents` | count of persisted `FeedbackEvent`s with that `reason` |
| `severity` | `severityFromEventRatio`: `disruptedRatio = (tachylaliaEvents + bradylaliaEvents) / totalWindows`; `none` if 0, `mild` if `< 0.15`, `moderate` if `< 0.4`, else `severe` |
| `articulationRateDeltaPercent` etc. | `(actual − baseline) ÷ baseline × 100`, `null` if baseline is 0/missing |

## 6. Tunable constants / configuration

### 6.1 DSP service (`services/dsp-service/app/core/config.py`, `.env`)

| Variable | Default | Meaning |
|---|---|---|
| `SAMPLE_RATE` | 16000 Hz | Audio sample-rate contract with the phone |
| `ANALYSIS_WINDOW_SEC` | 4.0 s | Trailing window for live rate features |
| `MIN_EMIT_INTERVAL_SEC` | 0.5 s | Minimum spacing between emitted metrics frames |
| `WARMUP_SEC` | 1.0 s | No metrics emitted until this much audio received |
| `HYSTERESIS_WINDOWS` | 3 | Consecutive windows a tachylalia deviation must persist for before confirming |
| `HYSTERESIS_WINDOWS_BRADYLALIA` | 5 | Same, for bradylalia (higher bar) |
| `FEEDBACK_REFRACTORY_SEC` | 4.0 s | Minimum gap between repeated vibration triggers |
| `MIN_SYLLABLES_PER_WINDOW` | 4 | Below this, a window can't produce a raw label |
| `MIN_PHONATION_SEC_PER_WINDOW` | 1.5 s | Below this, a window can't produce a raw label |
| `Z_TACHYLALIA` | 2.0 | `composite_z` threshold to raise a tachylalia label (personal baselines) |
| `Z_BRADYLALIA` | 2.0 | Magnitude threshold, negative direction, for bradylalia |
| `BASELINE_STD_FLOOR` | 0.15 syll/s | Floors `baselineArticulationRateStd` as a z-score denominator |
| `DEFAULT_BASELINE_ARTICULATION_RATE` | 4.4 syll/s | Population-default rate — **demoMode only** |
| `DEFAULT_BASELINE_ARTICULATION_RATE_STD` | 0.6 syll/s | Population-default spread |
| `DEFAULT_BASELINE_PAUSE_RATIO` / `_STD` | 1.5 / 0.6 | Population-default mean `speechToPauseRatio` + spread |
| `DEFAULT_BASELINE_SYLLABLE_DURATION_SEC` / `_STD` | 0.2 s / 0.05 s | Population-default syllable duration + spread |
| `TACHYLALIA_MULTIPLIER` | 1.55× | Fixed-multiplier upper threshold (non-personal sessions only) |
| `BRADYLALIA_MULTIPLIER` | 0.55× | Fixed-multiplier lower threshold (non-personal sessions only) |
| `MIN_CALIBRATION_PHONATION_SEC` | 20.0 s | Calibration rejected (422) below this pooled phonation time |
| `CALIBRATION_SUBWINDOW_SEC` | 4.0 s | Sub-window size for sampling calibration mean/std |
| `DEBUG_LOG_FRAMES` / `DEBUG_LOG_DIR` | off / `./logs/dsp-frames` | JSONL decision-audit logging for accuracy evaluation |
| `DSP_SERVICE_TOKEN` | unset | Bearer token gateway must present; unset = unauthenticated (dev only) |
| `CORS_ORIGINS` | `*` | Comma-separated allowed origins |

### 6.2 DSP pipeline constants (`app/pipeline/constants.py`, code-level, not env-tunable)

| Stage | Constant | Value |
|---|---|---|
| Preprocessing | Bandpass filter | 4th-order Butterworth, 80–4000 Hz |
| | STFT frame / hop | 512 / 256 samples (32ms / 50% overlap) |
| | Noise update percentile | 20th |
| | Over-subtraction factor | 1.5 |
| | Spectral floor | 0.05 |
| | Noise estimate smoothing | 0.9 (EMA) |
| | AGC target RMS | 0.1 |
| | AGC gain range | 0.2×–6.0× |
| | AGC smoothing | 0.85 (EMA) |
| VAD | Frame / hop | 20ms / 10ms |
| | Energy margin | 10 dB |
| | Max zero-crossing rate | 0.6 |
| | Noise floor percentile / window | 15th / 3.0s |
| | Onset / hangover frames | 2 / 5 |
| Segmentation | Minimum pause | 0.3 s (clinical IPU convention) |
| Pitch | Frame / hop | 30ms / 10ms |
| | Search range | 75–400 Hz |
| | Voicing threshold | 0.35 |
| Syllable nuclei | Intensity frame / hop | 32ms / 10ms |
| | Smoothing | 50ms moving average |
| | Silence threshold | window max dB − 25 dB |
| | Minimum dip | 2 dB |
| | Voicing required | yes, within 20ms of a voiced pitch frame |
| | Minimum interval | 0.08 s (~12.5 syll/s ceiling) |
| Rate conversion | Syllables/word | 1.4 |
| Composite score weights | rate / consistency / activity | 0.5 / 0.3 / 0.2; target voice-activity 0.6 |
| Composite z-score weights | rate / pause / syll | 0.6 / 0.25 / 0.15 (fixed, not env-tunable — retune via `evaluate_accuracy.py`, §12) |
| Confidence weights | progress / corroboration / z / sample | 0.4 / 0.3 / 0.2 / 0.1; z-scale 4.0 |
| Trend regression | window count | 4 |
| Words-per-30s buffer | window | 30.0 s |
| z-denominator floors | pause ratio / syllable duration | 0.1 / 0.02 |

### 6.3 Gateway (`services/gateway/.env`)

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | 4000 | HTTP/Socket.IO port |
| `MONGO_URI` | `mongodb://localhost:27017/speech_biofeedback` | Database connection |
| `JWT_ACCESS_SECRET` / `JWT_ACCESS_EXPIRES_IN` | — / 15m | Access token signing + lifetime |
| `JWT_REFRESH_SECRET` / `JWT_REFRESH_EXPIRES_IN` | — / 30d | Refresh token signing + lifetime |
| `BCRYPT_SALT_ROUNDS` | 12 | Password hashing cost |
| `CORS_ORIGIN` | `http://localhost:5173,http://localhost:5174` | Allowed origins |
| `FASTAPI_WS_URL` / `FASTAPI_REST_URL` | `ws://localhost:8000` / `http://localhost:8000` | DSP service endpoints |
| `FASTAPI_SERVICE_TOKEN` | unset | Bearer token sent to DSP service (must match its `DSP_SERVICE_TOKEN`) |
| `DSP_CONNECT_TIMEOUT_MS` | 5000 | DSP WebSocket connect timeout |
| `DSP_MAX_RECONNECT_ATTEMPTS` | 10 | DSP WebSocket reconnect ceiling |
| `DSP_RECONNECT_BASE_DELAY_MS` / `_MAX_DELAY_MS` | 1000 / 8000 | Exponential backoff bounds |
| `REDIS_URL` | unset | Enables multi-instance Socket.IO scaling when set |
| `RATE_LIMIT_WINDOW_MS` / `RATE_LIMIT_MAX` | 900000 / 300 | General API rate limit |
| `AUTH_RATE_LIMIT_MAX` | 20 | Stricter limit on auth endpoints |
| `BODY_LIMIT` | 5mb | Sized to fit a base64 ~30s calibration recording |

### 6.4 Vibration patterns (`services/gateway/src/utils/constants.js`)

| Mode | Pattern (ms, `[vibrate, pause, vibrate, ...]`) |
|---|---|
| `tachylalia` | `[80, 60, 80, 60, 80]` |
| `bradylalia` | `[300, 150, 300]` |
| Pitch/tone alert (independent cue) | `[50]` |

### 6.5 Frontend (`.env` per app)

| Variable | Meaning |
|---|---|
| `VITE_DEMO_MODE` | `true` = run against in-browser simulator, no backend needed |
| `VITE_API_URL` | Gateway REST base, e.g. `http://localhost:4000/api/v1` |
| `VITE_SOCKET_URL` | Gateway Socket.IO base, e.g. `http://localhost:4000` |

## 7. Decision logic (classification)

Implemented in `services/dsp-service/app/pipeline/classifier.py`. **Rule-based
hysteresis state machine — not a trained model.** Full derivation:
`CLASSIFICATION_ENGINE.md` §5–6.

### 7.1 Baseline states

| State | `is_personal` | Arises when | Method used |
|---|---|---|---|
| Uncalibrated | n/a (baseline = `None`) | No calibration on file, `demoMode` unset | Always `uncalibrated` — never tachylalia/bradylalia |
| Personal | `True` | Real audio calibration produced ≥2 sub-window samples | z-score method |
| Non-personal | `False` | `demoMode` population default, or legacy manual-rate calibration | Fixed-multiplier fallback |

**Calibration is mandatory for a real session** — there is no silent
population-default fallback for an uncalibrated patient.

### 7.2 Step 1 — raw label for the current window

```
if baseline is None:
    raw = UNCALIBRATED
elif not sample_sufficient:
    raw = <carried forward from last confirmed state, unchanged>
elif baseline.is_personal:
    if disorderMode == "tachylalia":
        raw = TACHYLALIA if composite_z > Z_TACHYLALIA else NORMAL
    else:
        raw = BRADYLALIA if composite_z < -Z_BRADYLALIA else NORMAL
else:  # fixed-multiplier fallback
    if disorderMode == "tachylalia":
        raw = TACHYLALIA if articulation_rate > tachylalia_threshold else NORMAL
    else:
        raw = BRADYLALIA if articulation_rate < bradylalia_threshold else NORMAL
```

### 7.3 Composite z-score (personal baselines only)

```
z_rate  = (articulation_rate − baseline_rate) ÷ max(baseline_rate_std, BASELINE_STD_FLOOR)
z_pause = (speech_to_pause_ratio − baseline_pause_mean) ÷ max(baseline_pause_std, 0.1)
z_syll  = -(avg_syllable_duration − baseline_syll_mean) ÷ max(baseline_syll_std, 0.02)
          # negated: shorter syllables = faster speech = tachy direction

composite_z = 0.6·z_rate + 0.25·z_pause + 0.15·z_syll
```

`zRate`/`zPause`/`zSyll`/`compositeZ` are exposed on every metrics frame
(personal or not — non-personal sessions get descriptive versions against
population-default std for display/audit only; they don't drive the decision).

### 7.4 Minimum-sample gating

A window with fewer than `MIN_SYLLABLES_PER_WINDOW` syllables or less than
`MIN_PHONATION_SEC_PER_WINDOW` phonation produces **no raw label** — the
previous confirmed state carries forward unchanged and hysteresis counters
are **not** reset. `sampleSufficient: false` is reported on that frame.

### 7.5 Step 2 — hysteresis confirmation + disorder-mode scoping

A per-label counter tracks consecutive raw-label windows; the state
**confirms** once the counter reaches `HYSTERESIS_WINDOWS` (tachylalia mode)
or `HYSTERESIS_WINDOWS_BRADYLALIA` (bradylalia mode). A session opens in
exactly one `disorderMode` (chosen at session start) and only ever evaluates
that single direction — **a tachylalia-mode session can never confirm
bradylalia, and vice versa.**

### 7.6 Step 3 — confidence score (0–1)

```
corroboration = fraction of {z_rate, z_pause, z_syll} agreeing in sign with the raw label's direction
sample_factor = min(1, syllables_in_window ÷ (MIN_SYLLABLES_PER_WINDOW × 2))
progress      = min(1, consecutive_windows_of_current_raw_label ÷ required_windows)

confidence = clip(0.4·progress + 0.3·corroboration + 0.2·min(1, |composite_z| ÷ 4) + 0.1·sample_factor, 0, 1)
```

### 7.7 Step 4 — feedback (vibration) trigger

Fires on the confirming edge, then re-fires at most every
`FEEDBACK_REFRACTORY_SEC` (4s) while the confirmed state stays abnormal — not
on every window. Vibration pattern is selected by the session's
`disorderMode` (§6.4), not the per-frame classification reason.

### 7.8 Session-final severity (gateway, post-hoc)

Distinct from the live per-window classification — computed once at session
end from the full `FeedbackEvent`/`SpeechMetric` history:
`severityFromEventRatio` (§5.5) buckets into `none` / `mild` / `moderate` /
`severe` by disrupted-window ratio, feeding `AnalysisResult.severity` and the
PDF report's recommendations text.

## 8. Data model / schema

### 8.1 MongoDB collections (`services/gateway/src/models/*.js`)

| Collection | Model | Key fields | Notes |
|---|---|---|---|
| Users | `User` | `name`, `email` (unique), `passwordHash` (bcrypt, `select:false`), `role` (`patient`/`clinician`/`admin`), `refreshTokens[]` (hashes only) | |
| Calibration | `Profile` | Flat "active" baseline fields (mirrors DSP `CalibrationResponse`), `isPersonal`, `tachylaliaThreshold`, `bradylaliaThreshold`, `calibrationHistory[]` | One per user (`userId` unique). History is **append-only** — recalibrating never overwrites past snapshots. |
| Devices | `Device` | `userId`, `type` (`phone`/`dashboard`), `pushToken`, `lastSeenAt` | |
| Speech Sessions | `Session` | `userId`, `deviceId`, `disorderMode`, `demoMode`, `status` (`active`/`completed`/`aborted`), `startedAt`/`endedAt`, embedded `summary` | `disorderMode` set once at start, immutable for session lifetime. |
| Speech Metrics | `SpeechMetric` | All 13 features + derived params + `classification`/`confidence`/z-scores, `sessionId`, `timestamp` | **MongoDB time-series collection** (`timeField: timestamp`, `metaField: sessionId`, `granularity: seconds`) — written several times/sec per active session. |
| Feedback Events | `FeedbackEvent` | `sessionId`, `reason` (tachylalia/bradylalia), `pattern[]`, `acknowledged` | |
| Analysis Results | `AnalysisResult` | `overallClassification`, `severity`, `classificationBreakdown`, averaged metrics, `baselineComparison`, `recommendations[]` | One `session_final` result per session (unique partial index); `realtime`/`periodic` types unbounded. |
| Reports | `Report` | `title`, `type`, `status` (draft/finalized/archived), `sessionIds[]`, `analysisResultIds[]`, `pdf.data` (Buffer, `select:false`), `sharedWith[]` | PDF stored directly on the document (small, vector-drawn, well under MongoDB's 16MB doc limit). |
| Notifications | `Notification` | `type`, `priority`, `channel`, `read`/`readAt`, `expiresAt` | TTL index on `expiresAt` for auto-expiry. |

### 8.2 Entity relationships

```
User ──1:1── Profile (calibration baseline, with append-only history)
User ──1:N── Session ──1:N── SpeechMetric (time-series)
                         └──1:N── FeedbackEvent
                         └──1:1── AnalysisResult (session_final)
User ──1:N── Report ──N:M── Session, AnalysisResult (referenced by id)
             Report ──N:M── User (sharedWith)
User ──1:N── Notification (optionally linked to a Session or Report)
User ──1:N── Device
```

### 8.3 DSP service — no persistent store

The DSP service holds no database. `app/session/registry.py` keeps
in-process per-session pipeline state (streaming filter/AGC state, running
totals, hysteresis counters) keyed by `sessionId`, discarded when the session
ends or the process restarts.

## 9. Tech stack

| Layer | Technology |
|---|---|
| Phone app | React 19, TypeScript, Vite 8, TailwindCSS 4, Socket.IO Client, AudioWorklet API |
| Dashboard app | React 19, TypeScript, Vite 8, TailwindCSS 4, Recharts 3, Framer Motion, TanStack React Query 5, Socket.IO Client, Axios |
| Gateway | Node.js ≥18, Express 4, Socket.IO 4, Mongoose 8 (MongoDB), Redis (optional, `@socket.io/redis-adapter`), JWT (`jsonwebtoken`), bcryptjs, Joi validation, PDFKit, Winston logging, Helmet, express-rate-limit |
| DSP service | Python ≥3.11, FastAPI, Uvicorn, NumPy, SciPy, Pydantic v2 / pydantic-settings |
| Testing | Jest + Supertest + mongodb-memory-server (gateway); Vitest + React Testing Library (dashboard); Pytest (dsp-service) |
| Deployment | Render (`render.yaml`) — dashboard/phone as static SPAs with SPA rewrite routing; gateway and dsp-service as web services; each with its own `Dockerfile` |

## 10. Interfaces / APIs

### 10.1 Gateway REST (`/api/v1`)

| Endpoint | Method | Auth | Purpose |
|---|---|---|---|
| `/health` | GET | none | Liveness/readiness (checks Mongo + DSP service) |
| `/auth/register` | POST | none | Create account |
| `/auth/login` | POST | none | Issue access + refresh token |
| `/auth/refresh` | POST | none | Rotate access token |
| `/auth/logout` | POST | bearer | Revoke a refresh token |
| `/users/me` | GET/PATCH | bearer | Read/update own profile |
| `/users/:id/calibration` | GET/PUT | bearer | Read/write calibrated baseline |
| `/sessions` | GET/POST | bearer | List / create sessions |
| `/sessions/:id` | GET/PATCH | bearer | Read / update (end) a session |
| `/sessions/:id/metrics` | GET | bearer | Paginated time-series for charts |
| `/sessions/:id/events` | GET | bearer | Feedback (vibration) event log |
| `/analysis-results` | GET/POST | bearer | List / create (clinician/admin) |
| `/analysis-results/:id` | GET/DELETE | bearer | Read / delete |
| `/reports` | GET/POST | bearer | List / create (clinician/admin) |
| `/reports/:id` | GET/PATCH/DELETE | bearer | Read/update/delete |
| `/reports/:id/share` | POST | bearer | Share with another user |
| `/reports/:id/download` | GET | bearer | Stream stored PDF |
| `/reports/sessions/:sessionId/generate` | POST | bearer | Generate/regenerate a session's PDF |
| `/notifications` | GET/POST | bearer | List own / send (clinician/admin) |
| `/notifications/:id/read` | PATCH | bearer | Mark read |
| `/notifications/read-all` | POST | bearer | Mark all read |
| `/notifications/:id` | DELETE | bearer | Delete |

All error responses: `{ success: false, error: { code, message, details? } }`.
Auth: JWT access token (default 15m) + refresh token (default 30d, rotated on
use, hashes stored server-side).

### 10.2 Gateway Socket.IO

Two namespaces, JWT passed as `auth: { token }` on connect:

- **`/device`** (phone): sends `session:start`, `audio:chunk` (binary),
  `device:heartbeat`, `session:stop` → receives `session:ack`,
  `vibration:command`, `session:error`.
- **`/dashboard`** (clinician/patient): sends `dashboard:subscribeUser`,
  `dashboard:subscribe`, `dashboard:unsubscribe` → receives
  `session:started`, `metrics:update`, `feedback:logged`, `session:ended`.

A patient may self-subscribe to their own `/dashboard` channel to read
`metrics:update` (used by the phone app to show "Current Classification"
without a second data path).

### 10.3 DSP service REST

| Endpoint | Method | Auth | Purpose |
|---|---|---|---|
| `/health` | GET | none | Liveness + active session count |
| `/models/version` | GET | bearer | Pipeline/algorithm version info |
| `/calibrate` | POST | bearer | Derive a baseline from reference clip(s) or a precomputed rate |

`POST /calibrate` priority order: `referenceStats.clips[]` (current, 2-clip
flow) > `referenceStats.audioBase64` (legacy single-clip) >
`referenceStats.articulationRateSPS` (manual rate, no std) >
`demoMode: true` (population default — never for a real patient).

### 10.4 DSP service WebSocket — `/ws/analyze/{sessionId}`

| Direction | Frame | Payload |
|---|---|---|
| Gateway → DSP | text | `{"type": "init", "sessionId": ..., "calibration": {...} \| null}` |
| Gateway → DSP | binary | raw PCM16 mono, 16kHz |
| Gateway → DSP | text | `{"type": "end"}` |
| DSP → Gateway | text | `{"type": "metrics", ...}` — every ≥0.5s |
| DSP → Gateway | text | `{"type": "summary", ...}` — reply to `end` |
| DSP → Gateway | text | `{"type": "error", "message": ...}` — non-fatal, connection stays open |

Example `metrics` frame:

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

### 10.5 Auth flow

`POST /auth/login` issues a short-lived access JWT (`role`, `email` claims)
and a refresh JWT; `POST /auth/refresh` rotates it. Every route except
`/health` (gateway) and `/health` (DSP) requires `Authorization: Bearer
<token>` — a gateway-issued user JWT for gateway routes, or the shared
`DSP_SERVICE_TOKEN`/`FASTAPI_SERVICE_TOKEN` for gateway → DSP service calls.

## 11. Known limitations

- **Not a diagnostic device / not clinically validated.** This is a
  deterministic signal-processing measurement tool with hand-set threshold
  constants, not a trained or clinically validated diagnostic. It should be
  used as a biofeedback aid alongside clinical judgment, not as a
  stand-alone diagnosis.
- **No machine learning.** Every output is a deterministic function of the
  audio (Butterworth filtering, spectral-subtraction denoising, energy+ZCR
  VAD, autocorrelation pitch tracking, De Jong & Wempe syllable-nuclei
  detection) plus hand-set thresholds — see [§12](#12-validation--accuracy-approach)
  for how those thresholds are meant to be tuned.
- **Calibration is required and consequential.** A patient who has never
  calibrated only ever gets `uncalibrated`; a *personal* baseline (with a
  usable std) requires ≥2 pooled calibration sub-window samples and
  ≥20s of actual detected phonation. A rushed or unrepresentative
  calibration recording will bias every subsequent session's classification.
- **`demoMode` is a real-patient footgun if misused.** It substitutes a
  population-default baseline and must never be set on a real patient
  session — nothing in the current code prevents a caller from setting it
  incorrectly (it's a plain boolean threaded through the session-start
  payload).
- **English-language assumption.** The 1.4 syllables/word approximation and
  the syllable-nuclei detector's parameters (silence threshold, minimum dip,
  minimum interval) were tuned for English speech; behavior on other
  languages/dialects is unverified.
- **Phone-side downsampling is not anti-aliased.** `apps/phone/src/lib/pcm.ts`
  downsamples the mic's native sample rate to 16kHz by averaging decimation,
  not a full anti-aliasing filter — adequate for speech-rate/pitch/loudness
  analysis but not audio-fidelity-critical use.
- **Pitch range is fixed at 75–400 Hz.** Adults/children with F0 outside
  this autocorrelation search range will get unreliable pitch-derived
  metrics (`meanPitchHz`, `pitchVariabilityHz`, and the z_syll/composite_z
  terms are unaffected, but pitch-trend-based UI alerts are).
- **Hysteresis trades responsiveness for stability.** Confirming a state
  change takes `HYSTERESIS_WINDOWS` (3, ~1.5s) or
  `HYSTERESIS_WINDOWS_BRADYLALIA` (5, ~2.5s) consecutive sufficient windows
  — real onset of disordered speech is only flagged after that delay, by
  design (to suppress false alarms on normal rate variation).
- **PDF reports are stored in MongoDB, not object storage.** Fine at current
  scale (small, vector-drawn PDFs, well under the 16MB document limit) but
  won't scale to embedded audio/video or very large report volumes.
- **DSP service holds no persistent session state.** A DSP-service restart
  mid-session drops all in-memory pipeline state for active sessions (the
  gateway's reconnect/backoff logic handles the *connection*, but analysis
  continuity/hysteresis counters are not restored).
- **No formal accuracy validation performed yet.** `scripts/evaluate_accuracy.py`
  and the `DEBUG_LOG_FRAMES` JSONL logging exist specifically to score
  classifier output against a clinician-labeled ground-truth CSV, but this
  has not yet been run against real patient data to produce a measured
  precision/recall/F1 — see [§12](#12-validation--accuracy-approach).
- **Threshold constants are hand-set defaults**, most explicitly documented
  as having been widened once already (`TACHYLALIA_MULTIPLIER` 1.35→1.55,
  `BRADYLALIA_MULTIPLIER` 0.65→0.55) because the originals misclassified
  normal speech too often — they are starting points meant to be retuned
  against real accuracy data, not final.

## 12. Validation & accuracy approach

The classifier is intentionally not machine-learned, so "training" doesn't
apply — but its threshold constants (`Z_TACHYLALIA`, `Z_BRADYLALIA`, the
composite-z and confidence weights in §6.2) are still empirical choices that
need validating against real labeled data. The intended workflow:

1. **Enable frame logging.** Set `DEBUG_LOG_FRAMES=true` on the DSP service
   (writes `<sessionId>.jsonl` to `DEBUG_LOG_DIR`). Every emitted frame logs:
   window timestamp, `articulationRateSPS`, `zRate`/`zPause`/`zSyll`/
   `compositeZ`, raw label, confirmed label, confidence, `sampleSufficient`.
2. **Collect clinician/tester ground truth.** A CSV with columns
   `start_sec,end_sec,label` — one row per reviewed time range of a
   recorded session.
3. **Score.** Run
   `scripts/evaluate_accuracy.py --session-log <path>.jsonl --ground-truth <path>.csv`
   — prints a confusion matrix plus per-class precision/recall/F1 for the
   *confirmed* label against ground truth.
4. **Retune.** Adjust `Z_TACHYLALIA` / `Z_BRADYLALIA` (env-overridable) or the
   composite-z / confidence weights (`app/pipeline/constants.py`, code-level)
   based on the confusion matrix, and re-run to confirm improvement.

As of this document, this loop has not yet been run against real recorded
patient sessions with clinician-labeled ground truth — no measured
precision/recall/F1 numbers currently exist. The unit test suites
(`services/dsp-service/tests/unit`) validate each pipeline stage in isolation
against synthetic sine-burst "utterances," which confirms the DSP math is
implemented correctly but does not substitute for accuracy validation against
real disordered speech.

## 13. Glossary

| Term | Definition |
|---|---|
| **Tachylalia** | Pathologically fast, often cluttered speech rate. |
| **Bradylalia** | Pathologically slow speech rate. |
| **Articulation rate** | Syllables per second of *actual talking time* (pauses excluded) — the primary classification signal. |
| **Speech rate** | Syllables (as words) per unit of *elapsed* time, pauses included — reported in words/min. |
| **Syllable nucleus** | The detected acoustic center (intensity peak) of one syllable; counting these is how articulation/speech rate is measured. |
| **IPU (Inter-Pausal Unit)** | A continuous run of speech bounded by pauses ≥0.3s — the standard clinical unit for segmenting an utterance into "runs." |
| **VAD (Voice Activity Detection)** | Frame-by-frame decision of whether the patient is speaking, gating what counts toward rate calculations. |
| **F0 (fundamental frequency)** | The acoustic correlate of perceived pitch, estimated per frame via autocorrelation. |
| **Phonation** | Actual voiced speech production time — distinct from mere audio duration, which may include silence/pauses. |
| **Calibration / baseline** | A per-patient reference recording used to derive that patient's own normal articulation rate, pause ratio, and syllable duration (mean + std). |
| **Personal baseline** | A calibration with a usable standard deviation (≥2 sub-window samples) — unlocks z-score classification. |
| **Non-personal baseline** | A calibration (or demo/manual value) without a usable std — falls back to fixed-multiplier thresholds. |
| **z-score (composite_z)** | Standardized deviation of the current window's speech metrics from the patient's own calibrated mean/std — the primary personal-baseline classification signal. |
| **Hysteresis** | Requiring a deviation to persist for N consecutive windows before confirming a state change, to suppress false alarms from normal rate variation. |
| **DisorderMode** | The single disorder direction (`tachylalia` or `bradylalia`) a session is scoped to at start — a session can only ever confirm that one direction. |
| **Sample sufficiency** | Gate requiring a minimum syllable count and phonation time per window before it's allowed to produce a raw classification label. |
| **Composite score** | A 0–100 general speech "wellness" indicator (rate closeness + rhythmic consistency + activity level) — descriptive only, does not drive classification. |
| **AGC (Automatic Gain Control)** | Normalizes speech loudness toward a target RMS level during preprocessing. |
| **De Jong & Wempe method** | The classical intensity-peak-picking algorithm (2009) used for syllable-nuclei detection — the standard Praat "speech rate" algorithm. |
| **PCM16** | 16-bit signed pulse-code-modulation audio — the raw wire format streamed from phone to gateway to DSP service. |
| **AnalysisResult** | A persisted, clinician/patient-facing diagnostic summary of one session — severity, classification breakdown, recommendations. |
| **Session summary** | A lightweight aggregate embedded directly on the `Session` document, computed at session end. |
