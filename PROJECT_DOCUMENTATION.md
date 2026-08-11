# Speech Biofeedback — Project Documentation

**Real-time, on-device tachylalia (fast-speech) biofeedback app.** A
single-screen, installable, **fully offline** web app that captures a
patient's speech from their phone's microphone, analyzes it in real time
with classical digital signal processing (DSP) running entirely in-browser,
classifies it as **Normal** or **Tachylalia** (pathologically fast/cluttered
speech), and triggers immediate haptic (vibration) feedback — with no
account, no backend, and no network call anywhere in the calibration or
live-session path.

This document is an engineering-handoff reference: architecture, data flow,
every computed parameter and its formula, every tunable constant, the
classification decision logic, the on-device data model, the tech stack,
known limitations, and a domain glossary.

> Repository layout: everything lives in `apps/phone`. There is no
> `services/` directory and no other `apps/*` — see
> [§0](#0-history-why-theres-only-one-app) for why.

---

## Table of contents

0. [History: why there's only one app](#0-history-why-theres-only-one-app)
1. [Overview](#1-overview)
2. [Problem statement](#2-problem-statement)
3. [Architecture](#3-architecture)
4. [Data flow](#4-data-flow)
5. [Output parameters (with formulas)](#5-output-parameters-with-formulas)
6. [Tunable constants / configuration](#6-tunable-constants--configuration)
7. [Decision logic (classification)](#7-decision-logic-classification)
8. [Data model / storage](#8-data-model--storage)
9. [Tech stack](#9-tech-stack)
10. [Module map / internal interfaces](#10-module-map--internal-interfaces)
11. [Deployment / builds](#11-deployment--builds)
12. [Known limitations](#12-known-limitations)
13. [Glossary](#13-glossary)

---

## 0. History: why there's only one app

This project used to be a 4-service cloud system: a phone capture app, a
separate clinician/patient dashboard, a Node.js/Express/Socket.IO gateway,
and a Python/FastAPI DSP service backed by MongoDB — all now **deleted**.
It was collapsed into the single offline PWA in `apps/phone`:

- The DSP pipeline (Butterworth bandpass filtering, spectral-subtraction
  denoising, energy+ZCR VAD, autocorrelation pitch tracking, De Jong & Wempe
  syllable-nuclei detection, and the z-score/hysteresis classifier) was
  **ported line-for-line from Python to TypeScript** and now runs
  client-side via the Web Audio API. The math, constants, and decision
  logic are unchanged from the original service.
- Calibration and session history moved from MongoDB (server-side) to
  **IndexedDB** (on-device, `apps/phone/src/storage/`).
- **Bradylalia (speaking too slow) support was removed.** This build only
  ever monitors for speaking too fast. There is no `disorderMode` concept
  anymore — a session always evaluates the tachylalia direction.
- There is no login, no clinician role, no dashboard, no PDF report, no
  REST API, and no WebSocket — it's a single real user on a single device.

If you're reading old commit history, PRs, or code comments that mention
`services/gateway`, `services/dsp-service`, `apps/dashboard`, `disorderMode`,
`demoMode`, or bradylalia — that all describes the previous architecture and
no longer applies to the code in this repository.

## 1. Overview

The entire product is one deployable: **`apps/phone`**, a React/TypeScript
Vite PWA. It has three screens (React Router, in-app only, no server-side
routing):

| Screen | Route | Role |
|---|---|---|
| **Live Session** | `/` | The home screen. Start/Stop a session; shows the live classification badge, confidence, and the full metrics panel while recording. |
| **Calibration** | `/calibrate` | Records two ~20s spoken passages and derives the patient's personal baseline. |
| **Today** | `/today` | End-of-day plain-language insight + a list of today's completed sessions. |

Everything — mic capture, DSP analysis, classification, calibration
storage, and session history — runs **in this one browser tab/WebView**.
`vite-plugin-pwa` precaches the full app shell (including the AudioWorklet
module) into a service worker on first load, so after that the app works
with the network fully off, including a fresh calibration or live session.
It can also be installed as a native **Android APK** via Capacitor.

## 2. Problem statement

Tachylalia is a speech-rate disorder — speaking pathologically too fast,
often with poor rhythm/consistency and cluttered articulation. It's hard for
a patient to self-monitor in the moment: by the time a listener (or the
patient themself) notices, the disordered pattern may have already run for
a while. Clinically, treatment relies on practicing self-awareness and
pacing, which benefits from **immediate, objective, in-the-moment
feedback** rather than only periodic clinician observation.

This app addresses that by:
1. Measuring the patient's speech rate and rhythm continuously from the
   phone mic during everyday practice.
2. Comparing it, in real time, against **that patient's own calibrated
   baseline** (not a generic population norm) using a statistically
   principled z-score.
3. Buzzing the phone the moment a deviation is confirmed (with hysteresis
   to avoid false alarms on normal rate variation), so the patient can
   self-correct immediately.
4. Giving the patient a same-device end-of-day summary (practice time, %
   time too fast, trend vs. yesterday) to self-track progress — there is no
   clinician-facing view in this build.

It is explicitly **not** a diagnostic/ML system (see
[§12](#12-known-limitations)); it's a deterministic DSP measurement +
rule-based classifier intended as a biofeedback aid, not a stand-alone
diagnosis.

## 3. Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                     Phone browser tab / WebView                   │
│                          apps/phone (React SPA)                    │
│                                                                     │
│  getUserMedia() ──▶ AudioWorkletNode ──▶ pcm.ts resample to 16kHz  │
│  (public/worklets/pcm-capture-processor.js)                        │
│         │                                                          │
│         ▼                                                          │
│  dsp/sessionPipeline.ts (SessionPipeline.processChunk)              │
│    preprocess (bandpass + spectral-subtract denoise + AGC)          │
│      → VAD (energy + ZCR) → segment into IPUs/pauses                │
│      → pitch contour (autocorrelation) → syllable-nuclei detection  │
│      → feature extraction → hysteresis classifier                   │
│         │                                                          │
│         ├─▶ metrics frame (~every 0.5s) ──▶ React state ──▶ UI      │
│         └─▶ triggerFeedback === true ──▶ navigator.vibrate(...)     │
│                (or beep.ts + visual flash if no Vibration API)      │
│                                                                     │
│  storage/ (IndexedDB, db "speechbio")                               │
│    calibration.ts — the one active BaselineProfile                  │
│    sessions.ts     — per-session summaries, indexed by calendar date│
│    insights.ts     — computes the Today screen's plain-language text│
└──────────────────────────────────────────────────────────────────┘
```

**Key architectural fact:** there is no network boundary anywhere in this
diagram. Everything is function calls and IndexedDB transactions within one
JS runtime. `SessionPipeline` (a class instance held in a `useRef`) *is*
what used to be the gateway + DSP service combined — it owns all
per-session streaming state directly, with no serialization, sockets, or
auth in between.

## 4. Data flow

### 4.1 Live session (audio → analysis → feedback)

All of this happens inside `useLiveSession()` (`src/hooks/useLiveSession.ts`):

1. **Start**: `startRecording()` kicks off `useAudioCapture().start()` (must
   happen synchronously in the click handler's call stack — see the
   "gesture linkage" note in §10) and, in parallel, reads the stored
   baseline from IndexedDB (`getCalibration()`). A new `SessionPipeline` is
   constructed with that baseline (`null` if never calibrated).
2. **Capture**: the `AudioWorkletNode` posts native-rate Float32 blocks off
   the audio thread; `resampleFloat32` converts them to 16kHz (up or down,
   whichever direction is needed — see `pcm.ts`); `PCMChunker` buffers them
   into fixed ~250ms/4000-sample frames and calls `onChunk`.
3. **Analyze**: each chunk goes straight into `pipeline.processChunk()`,
   which runs the full DSP pipeline (§5) over a trailing 4s analysis window
   and returns a `MetricsFrame` at most once every 0.5s (`null` otherwise,
   or during the first `warmupSec` of audio).
4. **Classify + feedback**: each frame carries the hysteresis-confirmed
   `classification` and a `triggerFeedback` boolean. On `triggerFeedback`,
   `useLiveSession` calls `navigator.vibrate([80, 60, 80, 60, 80])`
   directly — no event bus, no round trip. Browsers without the Vibration
   API (iOS Safari) get `playBeep()` (an oscillator tone) plus a visual
   screen flash instead.
5. **UI update**: the frame is pushed into React state (`setLatest`),
   re-rendering the classification badge and metrics panels on
   `LiveSessionPage` directly.
6. **Stop**: `stopRecording()` tears down the audio graph and builds a
   `SessionSummary` (duration, average articulation rate, time spent in
   tachylalia, feedback-trigger count, the baseline rate at the time of the
   session) and fire-and-forgets it into IndexedDB (`saveSession`).

### 4.2 Calibration flow

Driven by `CalibrationPage.tsx` + `lib/calibrationEngine.ts`:

1. The patient reads two independent ~20s passages
   (`lib/calibrationPassage.ts`) aloud, one at a time. Each is captured by
   `useCalibrationRecorder`, which records into one growing buffer
   (`PCMAccumulator`) rather than streaming — a calibration clip is
   analyzed as a whole, not live.
2. `runCalibration(clips)` runs each clip through
   `analyzeCalibrationClip()` (`dsp/sessionPipeline.ts`), which does **two**
   passes per clip: a whole-clip pass (descriptive stats: speech rate,
   pitch, loudness, pause ratio) and a per-4s-sub-window pass (samples that
   feed the personal mean/std for the z-score classifier).
3. All clips' sub-window samples are pooled. If pooled phonation time is
   under `minCalibrationPhonationSec` (20s), the attempt is rejected with a
   `CalibrationError` the UI surfaces as "Try Again" — mirrors the old DSP
   service's `422` rejection, enforced locally now.
4. `baselineFromSubwindowSamples()` (`dsp/baseline.ts`) turns the pooled
   samples into a `BaselineProfile` (mean + std of articulation rate, pause
   ratio, syllable duration, IPU length). `isPersonal` is `true` only if
   there are ≥2 pooled rate samples — a single sample's std is always 0,
   which would otherwise look "personal" but is really just noise.
5. The resulting `CalibrationRecord` is written to IndexedDB
   (`storage/calibration.ts`), **overwriting** the previous baseline in
   place (no append-only history in this build — that was a gateway/Mongo
   feature that didn't carry over).
6. Every subsequent live session loads this one stored baseline at
   `startRecording()` time.

### 4.3 Today / insights flow

`storage/sessions.ts` indexes every completed `SessionSummary` by local
calendar date (`dateKeyFor`, based on when the session *started*, not UTC).
`storage/insights.ts`'s `getDailySummary()` aggregates a date's sessions
(duration-weighted average rate, % time in tachylalia, alert count,
baseline delta), and `generateDailyInsight()` turns that into a
plain-language paragraph — including a same-day vs. yesterday comparison of
how close the average rate was to baseline. `TodayPage` computes this
on-demand every time the screen is opened (not just once at midnight).

## 5. Output parameters (with formulas)

Computed in `src/dsp/features.ts`'s `computeFeatureSet()`, emitted in every
`MetricsFrame` from `sessionPipeline.ts`. The formulas below are unchanged
from the original Python DSP service — only bradylalia-specific fields have
been removed.

### 5.1 The 13 core features

| # | Field (wire name) | Formula | Meaning |
|---|---|---|---|
| 1 | `articulationRateSPS` | `syllables_in_window ÷ phonation_seconds_in_window` | **Primary classification signal.** Syllables/sec of actual talking (pauses excluded) |
| 2 | `speechRateWPM` | `(syllables_in_window ÷ window_seconds) × 60 ÷ 1.4` | Words/min including pauses (1.4 syll/word English approximation) |
| 3 | `averageSyllableDurationSec` | `phonation_seconds_in_window ÷ syllables_in_window` | Average length of one syllable |
| 4 | `interSyllableIntervalSec` | mean gap between consecutive syllable nuclei within the same IPU (session-to-date) | Rhythm |
| 5 | `pauseDurationSec` | mean length of all pauses so far this session | Typical pause length |
| 6 | `pauseFrequencyPerMin` | `total_pause_count ÷ (elapsed_seconds ÷ 60)` | Pause frequency |
| 7 | `speechToPauseRatio` | `speech_seconds_in_window ÷ pause_seconds_in_window` | **Also feeds classification (`zPause`).** Talking vs. silence balance |
| 8 | `interPausalUnitLengthSec` | `total_speech_seconds ÷ total_IPU_count` | Average length of a continuous speech run |
| 9 | `meanPitchHz` | mean F0 over voiced frames in the window | Average pitch |
| 10 | `pitchVariabilityHz` | std. dev. of F0 over voiced frames in the window | Monotone vs. expressive |
| 11 | `loudnessDb` | mean energy (dB) of speech frames in the window | Loudness |
| 12 | `voiceActivityPercent` | `100 × total_speech_seconds ÷ elapsed_seconds` | % of session spent talking |
| 13 | `speechConsistency` | `clip(1 − CV(inter-syllable intervals), 0, 1)`, CV = std/mean | Rhythmic steadiness (1.0 = perfectly even; defaults to 1.0 until enough samples exist) |

Two accumulation strategies are used deliberately (`RunningStats` in
`features.ts`): **rate features (#1–3) and `speechToPauseRatio` (#7)** use
only the trailing `analysisWindowSec` (reacts quickly, drives
classification — #7 was a session-to-date cumulative ratio until it was
found to drift unboundedly away from the calibration baseline over a long
session, silently dominating `compositeZ` and misclassifying normal speech
as tachylalia with no way back to NORMAL; see `RunningStats.windowedPauseSec`/
`speechToPauseRatio` in `features.ts`); **remaining rhythm/descriptive
features (#4, #5, #6, #8, #12–13)** accumulate as session-to-date running
totals (O(1) memory, more stable, display-only — none of them feed
`compositeZ`); **pitch/loudness
(#9–11)** are recomputed fresh from the current window only.

### 5.2 Composite wellness score (0–100)

```
rate_closeness  = 1 − min(1, |articulation_rate − baseline_rate| ÷ baseline_rate)
activity_gap    = |voice_activity_ratio − 0.6| ÷ 0.6      # 0.6 = typical conversational speech:pause ratio
activity_score  = 1 − min(1, activity_gap)

composite_score = 100 × [0.5·rate_closeness + 0.3·speechConsistency + 0.2·activity_score]
```

A general quality/wellness indicator — **not** what drives the Tachylalia
label (see §7). Shown in the expandable secondary metrics panel.

### 5.3 Derived parameters

| Field | Formula | Meaning |
|---|---|---|
| `wordsPerLast30Sec` | nuclei in an independent trailing 30s ring buffer ÷ 1.4 | Own cadence, decoupled from the 4s classification window |
| `totalSyllablesSession` / `totalWordsSession` | session-cumulative nuclei / ÷1.4 | Monotonically non-decreasing |
| `rateTrend` | least-squares slope of `articulationRateSPS` over the last 4 windows vs. elapsed time | Positive = accelerating rate |
| `meanPitchTrendHz` | same, for `meanPitchHz` | Positive = rising pitch |
| `timeInAbnormalStateSec` | elapsed time since the confirmed state most recently became TACHYLALIA | Resets to 0 when NORMAL is reconfirmed |
| `recoveryTimeSec` | elapsed time from a `triggerFeedback=true` event to the next confirmed NORMAL | Emitted once per recovery, else `null` |
| `loudnessVariabilityDb` | std. dev. of energy (dB) over speech frames in the window | Loudness steadiness |

### 5.4 Classifier-output fields (not features)

`classification`, `confidence`, `triggerFeedback`, `feedbackReason`,
`sampleSufficient`, `zRate`, `zPause`, `zSyll`, `compositeZ` — see
[§7](#7-decision-logic-classification).

### 5.5 Session-level summary (on stop)

Computed once in `useLiveSession.stopRecording()` from streaming
accumulators kept alongside the pipeline (not a database aggregation —
there's no database):

| Field | Formula |
|---|---|
| `avgArticulationRateSPS` | mean of `articulationRateSPS` across all emitted frames this session |
| `timeInTachylaliaSec` | sum of `dt` (time between consecutive frames) while `classification === 'tachylalia'` |
| `feedbackTriggerCount` | count of frames with `triggerFeedback === true` |
| `baselineArticulationRateAtSession` | the loaded baseline's rate at session start, for later "closer/further" comparisons in Today |

`storage/insights.ts` further aggregates same-day `SessionSummary`s into a
`DailySummary` (§4.3) — no severity bucketing, no PDF, no clinician-facing
`AnalysisResult` in this build.

## 6. Tunable constants / configuration

There are no environment variables or `.env` files anymore — this is a
single-user, on-device app. Everything tunable lives in two plain TypeScript
files, editable directly.

### 6.1 `src/dsp/config.ts` (`Settings`, easily overridable per-instance)

| Field | Default | Meaning |
|---|---|---|
| `sampleRate` | 16000 Hz | Audio contract for the whole pipeline |
| `analysisWindowSec` | 4.0 s | Trailing window for live rate features |
| `minEmitIntervalSec` | 0.5 s | Minimum spacing between emitted metrics frames |
| `warmupSec` | 1.0 s | No metrics emitted until this much audio received |
| `hysteresisWindows` | 3 | Consecutive same-raw-label emits required before confirming (guard 1 of 2 — see §7.5) |
| `hysteresisSustainSec` | 3.0 s | Real wall-clock time the raw label must also hold continuously before confirming (guard 2 of 2, independent of emit cadence) |
| `compositeZSmoothingAlpha` | 0.35 | EMA smoothing factor applied to `compositeZ` before it's compared against `zTachylalia`, so a single burst can't cross the threshold alone |
| `minSyllablesPerWindow` | 3 | Below this, a window can't produce a raw label |
| `minPhonationSecPerWindow` | 1.0 s | Below this, a window can't produce a raw label |
| `zTachylalia` | 1.4 | Smoothed-`compositeZ` threshold to raise a tachylalia label (personal baselines) |
| `baselineStdFloor` | 0.15 syll/s | Floors `baselineArticulationRateStd` as a z-score denominator |
| `toneAlertZThreshold` / `toneAlertSustainSec` | 1.5 / 3.0 s | Informational pitch/tone toast (no vibration) — see §6.3 |
| `toneAlertSmoothingAlpha` / `toneAlertCooldownSec` / `toneAlertToastVisibleSec` | 0.35 / 6.0 s / 4.0 s | EMA smoothing, minimum re-fire gap, and toast visible duration for the tone alert |
| `defaultBaselineArticulationRate` / `_Std` | 4.4 / 0.6 syll/s | Fallback used only inside the calibration-clip descriptive pass, never as a silent live-session substitute |
| `defaultBaselinePauseRatio` / `_Std` | 1.5 / 0.6 | Same, for pause ratio |
| `defaultBaselineSyllableDurationSec` / `_Std` | 0.2 s / 0.05 s | Same, for syllable duration |
| `tachylaliaMultiplier` | 1.25× | Fixed-multiplier upper threshold (non-personal baseline fallback) — 25% above the patient's own measured rate |
| `minCalibrationPhonationSec` | 20.0 s | Calibration rejected below this pooled phonation time |
| `calibrationSubwindowSec` | 4.0 s | Sub-window size for sampling calibration mean/std |

### 6.2 `src/dsp/constants.ts` (pipeline-internal, code-level)

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
| Composite z-score weights | rate / pause / syll | 0.6 / 0.25 / 0.15 |
| Confidence weights | progress / corroboration / z / sample | 0.4 / 0.3 / 0.2 / 0.1; z-scale 4.0 |
| Trend regression | window count | 4 |
| Words-per-30s buffer | window | 30.0 s |
| z-denominator floors | pause ratio / syllable duration | 0.1 / 0.02 |

### 6.3 Alert delivery (`lib/haptics.ts`, `hooks/usePitchAlert.ts`)

| Alert | Delivery | Re-fire behavior |
|---|---|---|
| Tachylalia confirmed | One continuous ~2.2s vibration (`mainAlertHaptic()` — native `Haptics.vibrate`, falls back to `navigator.vibrate`, then a synthesized beep + visual pulse) | Strictly edge-triggered (NORMAL→TACHYLALIA transition only, see §7.7) — never re-fires while the state merely persists |
| Pitch/tone deviation (independent, informational only) | Toast only, **never vibrates** (`toneAlertZThreshold`/`toneAlertSustainSec` gate) | At most every `toneAlertCooldownSec` (6s), visible for `toneAlertToastVisibleSec` (4s) |

## 7. Decision logic (classification)

Implemented in `src/dsp/classifier.ts`'s `HysteresisClassifier`. **Rule-based
hysteresis state machine — not a trained model.** Tachylalia-only: there is
no `disorderMode`, and `HYSTERESIS_WINDOWS_BRADYLALIA`/`Z_BRADYLALIA` no
longer exist.

### 7.1 Baseline states

| State | `isPersonal` | Arises when | Method used |
|---|---|---|---|
| Uncalibrated | n/a (baseline = `null`) | No calibration saved yet | Always `uncalibrated` — never `tachylalia` |
| Personal | `true` | Calibration produced ≥2 pooled sub-window rate samples | z-score method |
| Non-personal | `false` | Calibration produced fewer than 2 usable samples | Fixed-multiplier fallback |

**Calibration is mandatory** — there is no silent population-default
fallback for a real session. If the patient has never calibrated,
`baseline` is `null` and the classifier only ever returns `uncalibrated`,
regardless of how fast the patient talks.

### 7.2 Step 1 — raw label for the current window

```
if baseline === null:
    raw = UNCALIBRATED
elif !sampleSufficient:
    raw = <carried forward from last confirmed state, unchanged>
elif baseline.isPersonal:
    raw = TACHYLALIA if smoothed_composite_z > zTachylalia else NORMAL
else:  // fixed-multiplier fallback
    raw = TACHYLALIA if articulationRate > baseline.tachylaliaThreshold else NORMAL
```

### 7.3 Composite z-score (personal baselines only)

```
z_rate  = (articulation_rate − baseline_rate) ÷ max(baseline_rate_std, baselineStdFloor)
z_pause = (speech_to_pause_ratio − baseline_pause_mean) ÷ max(baseline_pause_std, 0.1)
z_syll  = -(avg_syllable_duration − baseline_syll_mean) ÷ max(baseline_syll_std, 0.02)
          # negated: shorter syllables = faster speech = tachy direction

composite_z          = 0.6·z_rate + 0.25·z_pause + 0.15·z_syll
smoothed_composite_z = EMA(composite_z, alpha=compositeZSmoothingAlpha)
                        # only updated on sample-sufficient windows; this
                        # smoothed value, not the raw composite_z, is what's
                        # thresholded in §7.2 and reported as `compositeZ`
```

`speech_to_pause_ratio` (feeding `z_pause`) is computed over the trailing
`analysisWindowSec`, same as `articulation_rate` — **not** a session-to-date
running ratio (see §5.1 #7's note): using a cumulative ratio here let
`z_pause` drift unboundedly over a long session regardless of current
speech, which could push `compositeZ` past `zTachylalia` on its own and,
being monotonic, effectively never let the state revert back to NORMAL.

`zRate`/`zPause`/`zSyll`/`compositeZ` are exposed on every metrics frame
(personal or not — non-personal windows get descriptive versions against
default std for display only; they don't drive the decision).

### 7.4 Minimum-sample gating

A window with fewer than `minSyllablesPerWindow` syllables or less than
`minPhonationSecPerWindow` phonation produces **no raw label** — the
previous confirmed state carries forward unchanged and hysteresis counters
are **not** reset. `sampleSufficient: false` is reported on that frame.

### 7.5 Step 2 — hysteresis confirmation

A per-label counter tracks consecutive raw-label windows (every label,
including NORMAL, so a confirmed TACHYLALIA state reconfirms NORMAL the
same way it confirmed TACHYLALIA — there is no special-cased one-way
latch). The state **confirms** once two independent guards are both
satisfied: (a) the counter reaches `hysteresisWindows` (3 consecutive
sufficient windows) **and** (b) the raw label has held continuously for
`hysteresisSustainSec` (3.0s of real recording time, not just emit count —
guard (a) alone could confirm a change in as little as ~1.5s at the default
0.5s emit interval, too fast to read as "sustained").

### 7.6 Step 3 — confidence score (0–1)

```
corroboration = fraction of {z_rate, z_pause, z_syll} agreeing in sign with the raw label's direction
sample_factor = min(1, syllables_in_window ÷ (minSyllablesPerWindow × 2))
progress      = min(1, consecutive_windows_of_current_raw_label ÷ hysteresisWindows)

confidence = clip(0.4·progress + 0.3·corroboration + 0.2·min(1, |composite_z| ÷ 4) + 0.1·sample_factor, 0, 1)
```

### 7.7 Step 4 — feedback (vibration) trigger

Strictly edge-triggered: fires exactly once on the NORMAL→TACHYLALIA
confirming edge, never again while the state merely persists, and not
again until a confirmed return to NORMAL is followed by a fresh confirming
transition back to TACHYLALIA. A periodic "also re-fire every few seconds
while still abnormal" behavior used to live here; removed because combined
with how sticky a confirmed state can be, it produced vibration that felt
continuous and disconnected from the patient's actual current speech.

## 8. Data model / storage

All persistence is **IndexedDB**, database name `speechbio`
(`src/storage/db.ts`), no server, no sync. Two object stores:

| Store | Key | Shape | Written by |
|---|---|---|---|
| `calibration` | fixed key `"current"` | `CalibrationRecord` (a `BaselineProfile` plus descriptive fields: `baselineSpeechRateWPM`, `baselinePitchHz`, `baselineLoudnessDb`, `baselinePauseDurationSec`, `baselineSpeechRatio`, `durationSec`, `syllableCount`, `clipCount`, `calibratedAt`) | `runCalibration()` — **overwrites in place**, no history kept |
| `sessions` | `id` (session id), indexed by `dateKey` | `SessionSummary` (§5.5 fields + `id`, `dateKey`, `startedAt`, `endedAt`, `durationSec`) | `useLiveSession.stopRecording()`, once per completed session with `durationSec > 0` |

There is no per-frame metrics persistence — `MetricsFrame`s live only in
React state (`latest`) while a session is recording and are discarded on
stop; only the session-level `SessionSummary` survives. There is no
Users/Profile/FeedbackEvent/AnalysisResult/Report/Notification model — all
of that was gateway/MongoDB machinery that was deleted along with the
backend.

## 9. Tech stack

| Layer | Technology |
|---|---|
| App | React 19, TypeScript ~6.0, Vite 8, TailwindCSS 4, React Router 7 |
| Audio | Web Audio API (`AudioWorkletNode`, `public/worklets/pcm-capture-processor.js`), `navigator.vibrate()`, oscillator-based beep fallback |
| Offline | `vite-plugin-pwa` (Workbox-generated service worker, `autoUpdate` registration) |
| Storage | Raw IndexedDB (no wrapper library) |
| Native packaging | Capacitor 7 (`@capacitor/core`, `@capacitor/android`), committed `android/` native project |
| Lint/build | `oxlint`, `tsc -b && vite build` |
| Deployment | Render (`render.yaml`, static site) for the web/PWA build; GitHub Actions (`.github/workflows/build-apk.yml`) for the Android debug APK |

No test suite is wired up yet — `npm run build` (type-check + production
build) and `npm run lint` are the only checks today.

## 10. Module map / internal interfaces

```
apps/phone/
  public/worklets/pcm-capture-processor.js   AudioWorkletProcessor: pulls
                                              native-rate audio off the
                                              audio thread, posts Float32
                                              blocks to the main thread
  src/
    dsp/            ported TypeScript DSP pipeline
      constants.ts        all pipeline-internal tuning constants (§6.2)
      config.ts           Settings — top-level tunables (§6.1)
      preprocessing.ts    Butterworth bandpass + spectral-subtraction denoise + AGC
      vad.ts              energy+ZCR voice activity detector
      segmentation.ts     frame decisions -> speech/pause IPU segments
      pitch.ts            autocorrelation F0 contour estimation
      syllables.ts        De Jong & Wempe syllable-nuclei detection
      fft.ts / butterworth.ts   shared DSP math (FFT, IIR filter design)
      features.ts         RunningStats accumulator + computeFeatureSet()
      baseline.ts         BaselineProfile construction (calibration -> baseline)
      classifier.ts       HysteresisClassifier (§7)
      sessionPipeline.ts  SessionPipeline (live) + analyzeCalibrationClip (calibration)
    storage/        IndexedDB (§8)
      db.ts               low-level idb open/get/put/delete helpers
      calibration.ts      the one active BaselineProfile record
      sessions.ts         per-session summaries, indexed by calendar date
      insights.ts         Today screen's daily aggregation + plain-language text
    lib/
      pcm.ts              resampling (either direction) + chunking/accumulation
      micStream.ts        getUserMedia with constraint fallback + retry + rich error diagnostics
      calibrationEngine.ts  runCalibration() — orchestrates the calibration flow
      calibrationPassage.ts  the two reading passages
      beep.ts             Vibration API fallback tone
    hooks/
      useAudioCapture.ts       mic permission + Web Audio graph + worklet wiring
      useLiveSession.ts        owns SessionPipeline instance, drives feedback + summary save
      useCalibrationRecorder.ts  fixed-duration single-clip recording
      useCalibrationProfile.ts   reads the stored baseline for display
      usePitchAlert.ts           independent "lower your tone" prosody cue
    components/     ClassificationBadge, PrimaryMetricsPanel, SecondaryMetricsPanel,
                    StatusPill, CalibrationSummary, MicErrorMessage, Toast
    pages/          LiveSessionPage, CalibrationPage, TodayPage
    App.tsx         3-route React Router switch, no auth/mode gating
  android/          Capacitor native Android project (committed)
```

**Gesture-linkage constraint** (important, easy to break): mobile browsers
only treat `AudioContext`/`AudioWorkletNode` creation as user-activated if
it happens synchronously in a click handler's call stack. `useAudioCapture`
creates the `AudioContext` "as the very first thing" in `start()`, and
`useLiveSession.startRecording()` deliberately calls `capture.start()`
**before** `await getCalibration()` — inserting an `await` ahead of
`capture.start()` breaks that linkage and makes worklet setup fail with "No
execution context available." See the inline comments in both files before
reordering anything there.

## 11. Deployment / builds

- **Web (PWA)**: `render.yaml` deploys `apps/phone` as a Render static site
  (`npm ci && npm run build`, SPA rewrite to `index.html`). Optional —
  installing it once from any browser makes it work fully offline after.
- **Android APK**: `.github/workflows/build-apk.yml` builds an unsigned
  debug APK via Capacitor on every push to `apps/phone/**`, or manually via
  `workflow_dispatch`. Locally: `npm run build && npx cap sync android &&
  cd android && ./gradlew assembleDebug` (needs Android SDK + JDK 17/21).
  Signed release-build instructions are in the workflow file's trailing
  comment.
- Mic access inside the Capacitor WebView needs three things wired together
  (already done in `android/app/src/main/java/.../MainActivity.java` and
  `AndroidManifest.xml`): the `RECORD_AUDIO` manifest permission, a runtime
  permission grant, and a `WebChromeClient.onPermissionRequest` override.
  `MODIFY_AUDIO_SETTINGS` is also declared — required for reliable mic
  capture on some real devices.

## 12. Known limitations

- **Not a diagnostic device / not clinically validated.** This is a
  deterministic signal-processing measurement tool with hand-set threshold
  constants, not a trained or clinically validated diagnostic.
- **No machine learning.** Every output is a deterministic function of the
  audio (Butterworth filtering, spectral-subtraction denoising, energy+ZCR
  VAD, autocorrelation pitch tracking, De Jong & Wempe syllable-nuclei
  detection) plus hand-set thresholds.
- **No accuracy-validation tooling in this build.** The old DSP service had
  `DEBUG_LOG_FRAMES` JSONL logging and an `evaluate_accuracy.py` script to
  score the classifier against clinician-labeled ground truth; neither was
  ported to this app. There is currently no measured precision/recall/F1
  and no built-in way to produce one — logging per-frame decisions to
  IndexedDB or `console.log` and scoring offline would need to be added.
- **Tachylalia-only.** Bradylalia (speaking too slow) detection was removed
  entirely — this build cannot flag speech that's too slow.
- **Calibration is required and consequential.** An uncalibrated patient
  only ever gets `uncalibrated`; a *personal* baseline (with a usable std)
  requires ≥2 pooled calibration sub-window samples and ≥20s of actual
  detected phonation. A rushed or unrepresentative calibration recording
  biases every subsequent session's classification. Recalibrating
  **overwrites** the previous baseline — there's no history to roll back to.
- **Single user, single device, no backup.** All data (calibration +
  session history) lives only in that browser's/WebView's IndexedDB. There
  is no export, sync, or account — clearing site data, uninstalling the
  app, or switching devices loses everything. There is no multi-patient or
  clinician-facing view.
- **English-language assumption.** The 1.4 syllables/word approximation and
  the syllable-nuclei detector's parameters (silence threshold, minimum
  dip, minimum interval) were tuned for English speech; behavior on other
  languages/dialects is unverified.
- **Phone-side downsampling is not anti-aliased.** `src/lib/pcm.ts`
  resamples by averaging decimation (or linear-interpolation upsampling),
  not a full anti-aliasing filter — adequate for speech-rate/pitch/loudness
  analysis but not audio-fidelity-critical use.
- **Pitch range is fixed at 75–400 Hz.** Adults/children with F0 outside
  this autocorrelation search range get unreliable pitch-derived metrics
  (`meanPitchHz`, `pitchVariabilityHz`); the z_syll/composite_z terms are
  unaffected, but the pitch-trend prosody alert is.
- **Hysteresis trades responsiveness for stability.** Confirming a state
  change takes `hysteresisWindows` (3, ~1.5s) consecutive sufficient
  windows — real onset of fast speech is only flagged after that delay, by
  design, to suppress false alarms on normal rate variation.
- **Threshold constants are hand-set defaults**, ported as-is from the
  original service (where `tachylaliaMultiplier` was already widened once,
  1.35→1.55, because the original misclassified normal speech too often).
  They are starting points, not clinically final values.
- **All processing runs on the main JS thread** (not a Web Worker/AudioWorklet
  for the DSP math itself, only capture is on the audio thread) — heavier
  phones or longer sessions could see UI jank during analysis, though the
  ~4s-window / 0.5s-cadence design keeps each `processChunk()` call cheap
  in practice.

## 13. Glossary

| Term | Definition |
|---|---|
| **Tachylalia** | Pathologically fast, often cluttered speech rate — the only disorder this build detects. |
| **Articulation rate** | Syllables per second of *actual talking time* (pauses excluded) — the primary classification signal. |
| **Speech rate** | Syllables (as words) per unit of *elapsed* time, pauses included — reported in words/min. |
| **Syllable nucleus** | The detected acoustic center (intensity peak) of one syllable; counting these is how articulation/speech rate is measured. |
| **IPU (Inter-Pausal Unit)** | A continuous run of speech bounded by pauses ≥0.3s — the standard clinical unit for segmenting an utterance into "runs." |
| **VAD (Voice Activity Detection)** | Frame-by-frame decision of whether the patient is speaking, gating what counts toward rate calculations. |
| **F0 (fundamental frequency)** | The acoustic correlate of perceived pitch, estimated per frame via autocorrelation. |
| **Phonation** | Actual voiced speech production time — distinct from mere audio duration, which may include silence/pauses. |
| **Calibration / baseline** | A per-patient reference recording used to derive that patient's own normal articulation rate, pause ratio, and syllable duration (mean + std). Stored as the single active record in IndexedDB. |
| **Personal baseline** | A calibration with a usable standard deviation (≥2 sub-window samples) — unlocks z-score classification. |
| **Non-personal baseline** | A calibration with too few usable samples — falls back to fixed-multiplier thresholds. |
| **z-score (compositeZ)** | Standardized deviation of the current window's speech metrics from the patient's own calibrated mean/std — the primary personal-baseline classification signal. |
| **Hysteresis** | Requiring a deviation to persist for N consecutive windows before confirming a state change, to suppress false alarms from normal rate variation. |
| **Sample sufficiency** | Gate requiring a minimum syllable count and phonation time per window before it's allowed to produce a raw classification label. |
| **Composite score** | A 0–100 general speech "wellness" indicator (rate closeness + rhythmic consistency + activity level) — descriptive only, does not drive classification. |
| **AGC (Automatic Gain Control)** | Normalizes speech loudness toward a target RMS level during preprocessing. |
| **De Jong & Wempe method** | The classical intensity-peak-picking algorithm (2009) used for syllable-nuclei detection — the standard Praat "speech rate" algorithm. |
| **SessionPipeline** | The `dsp/sessionPipeline.ts` class that owns one live session's entire streaming DSP + classification state, in-process, in the browser tab. |
| **SessionSummary** | The lightweight per-session record saved to IndexedDB on stop — duration, average rate, time in tachylalia, feedback count, baseline-at-session-time. |
| **DailySummary** | `storage/insights.ts`'s aggregation of a calendar day's `SessionSummary`s, feeding the Today screen's stats and plain-language insight text. |
