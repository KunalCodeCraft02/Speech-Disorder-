# Speech Classification Engine — Parameters & Decision Logic

Documentation of `services/dsp-service/app/pipeline/*`. Describes every parameter computed from
the patient's audio, every tunable constant that shapes the computation, and the exact logic used
to decide **Uncalibrated / Normal / Tachylalia (too fast) / Bradylalia (too slow)**.

Source files referenced: `constants.py`, `config.py`, `preprocessing.py`, `vad.py`,
`segmentation.py`, `pitch.py`, `syllables.py`, `features.py`, `baseline.py`, `classifier.py`,
`session_pipeline.py`, `scripts/evaluate_accuracy.py`.

**v2 changes (this revision):** calibration is now mandatory (no silent population-default
fallback for a real patient — §5), classification uses a personal z-score against the patient's
own calibrated variance instead of a fixed percentage (§6), a session is scoped to a single
disorder direction chosen up front (§6.4), minimum-sample gating prevents a too-quiet window from
producing a decision (§6.3), confidence now factors in multi-parameter corroboration (§6.5), and
several new derived parameters were added (§4.1). The DSP extraction methods themselves
(Butterworth filtering, VAD, autocorrelation pitch tracking, De Jong & Wempe syllable-nuclei
detection — §3) are unchanged.

---

## 1. Pipeline order

```
raw PCM16 audio (16kHz mono, from phone)
  → Preprocessing   (bandpass filter + spectral denoise + AGC)
  → VAD             (is this 20ms frame speech or silence?)
  → Segmentation     (group frames into speech/pause segments)
  → Pitch tracking   (F0 per 30ms frame, autocorrelation)
  → Syllable nuclei  (intensity peak-picking, voicing-gated)
  → Feature extraction (13 metrics + composite score)
  → Classification   (Normal / Tachylalia / Bradylalia, hysteresis + confidence)
  → metrics frame sent to gateway → dashboard/phone
```

This runs once per **analysis window** (default every 4 seconds of audio, re-emitted at most
every 0.5s — see §7). It is **not** a machine-learning model; every number is a deterministic
signal-processing calculation.

---

## 2. Session/runtime parameters (environment variables, `config.py`)

These control *when* and *how often* the engine runs, and the population defaults used before a
patient has calibrated. All are overridable via `.env`.

| Parameter | Default | Meaning |
|---|---|---|
| `SAMPLE_RATE` | 16000 Hz | Expected audio sample rate contract with the phone |
| `ANALYSIS_WINDOW_SEC` | 4.0 s | Trailing window of audio used to compute the "live" rate features (articulation rate, speech rate) each pass |
| `MIN_EMIT_INTERVAL_SEC` | 0.5 s | Minimum spacing between two emitted metrics frames — throttles how often a new decision is pushed out |
| `WARMUP_SEC` | 1.0 s | No metrics are emitted until this much audio has been received (avoids a noisy first-window decision) |
| `HYSTERESIS_WINDOWS` | 3 | Consecutive analysis windows a tachylalia deviation must persist for before the classifier **confirms** a state change |
| `HYSTERESIS_WINDOWS_BRADYLALIA` | 5 | Same, for bradylalia — higher bar because normal speech has more natural rate dips than spikes |
| `FEEDBACK_REFRACTORY_SEC` | 4.0 s | Minimum gap between repeated vibration-feedback triggers while the patient stays abnormal |
| `MIN_SYLLABLES_PER_WINDOW` | 4 | A window with fewer syllables than this can't produce a raw label — see §6.3 |
| `MIN_PHONATION_SEC_PER_WINDOW` | 1.5 s | A window with less phonation time than this can't produce a raw label — see §6.3 |
| `Z_TACHYLALIA` | 2.0 | composite_z must exceed this (personal-baseline sessions only) to raise a raw tachylalia label |
| `Z_BRADYLALIA` | 2.0 | composite_z must fall below −this (personal-baseline sessions only) to raise a raw bradylalia label |
| `BASELINE_STD_FLOOR` | 0.15 syll/s | Floors `baselineArticulationRateStd` before it's used as a z-score denominator, so a near-zero personal std can never blow up or NaN a z-score |
| `DEFAULT_BASELINE_ARTICULATION_RATE` | 4.4 syll/s | Population-default "normal" speech rate — **demoMode only**, see §5.1 |
| `DEFAULT_BASELINE_ARTICULATION_RATE_STD` | 0.6 syll/s | Population-default spread — descriptive only; demoMode sessions never use the z-score method |
| `DEFAULT_BASELINE_PAUSE_RATIO` | 1.5 | Population-default mean `speechToPauseRatio` (not a 0–1 fraction — see §5.2) |
| `DEFAULT_BASELINE_PAUSE_RATIO_STD` | 0.6 | Population-default spread, same scale |
| `DEFAULT_BASELINE_SYLLABLE_DURATION_SEC` / `_STD` | 0.2 s / 0.05 s | Population-default syllable duration + spread |
| `TACHYLALIA_MULTIPLIER` | 1.55× | Baseline rate × this = the fixed-multiplier upper (too-fast) threshold — used only for non-personal (demoMode/manual-rate) sessions, §5.1/§6.1. Widened from 1.35× — the old value misclassified normal speech too often |
| `BRADYLALIA_MULTIPLIER` | 0.55× | Same, lower (too-slow) threshold. Widened from 0.65× |
| `MIN_CALIBRATION_PHONATION_SEC` | 20.0 s | A calibration attempt (pooled across all submitted clips) with less actual phonation than this is rejected with a 422 — see §5.3 |
| `CALIBRATION_SUBWINDOW_SEC` | 4.0 s | Calibration recordings are split into sub-windows this long to sample the patient's own mean/std — see §5.2 |
| `DEBUG_LOG_FRAMES` / `DEBUG_LOG_DIR` | off / `./logs/dsp-frames` | When enabled, every window's decision inputs/outputs are appended as JSONL per session, for `scripts/evaluate_accuracy.py` — see §9 |

---

## 3. Stage-by-stage parameters

### 3.1 Preprocessing (`preprocessing.py`, `constants.py`)

Cleans the raw signal before anything else touches it.

| Parameter | Value | Purpose |
|---|---|---|
| Bandpass filter | 4th-order Butterworth, 80 Hz – 4000 Hz | Removes rumble/hum and content outside the speech band; IIR state persisted across chunks (no clicks at chunk boundaries) |
| STFT frame / hop | 512 / 256 samples (32ms / 50% overlap) | Frame size for the spectral denoiser |
| Noise update percentile | 20th percentile | Frames quieter than this update the running noise estimate |
| Over-subtraction factor | 1.5 | How aggressively estimated noise is subtracted from the spectrum (spectral subtraction denoising) |
| Spectral floor | 0.05 (5%) | Minimum magnitude retained per bin, prevents "musical noise" artifacts |
| Noise estimate smoothing | 0.9 (EMA) | Smooths the noise floor estimate over time |
| AGC target RMS | 0.1 | Automatic gain control normalizes speech loudness toward this level |
| AGC gain range | 0.2× – 6.0× | Clamps how much the AGC can boost/cut |
| AGC smoothing | 0.85 (EMA) | Attack/release smoothing on the gain |

### 3.2 Voice Activity Detection — VAD (`vad.py`)

Decides, frame by frame, whether the patient is speaking. **This directly gates which audio counts
toward the rate calculation.**

| Parameter | Value | Purpose |
|---|---|---|
| Frame / hop | 20ms / 10ms | VAD analysis granularity |
| Energy margin | 10 dB | Frame must exceed the adaptive noise floor by this much to be "speech" |
| Max zero-crossing rate | 0.6 | Frames noisier than this are rejected even if loud enough (rejects hiss/static) |
| Noise floor percentile | 15th percentile | Noise floor = this percentile of recent quiet-frame energies |
| Noise floor window | 3.0 s | How much recent history feeds the adaptive noise floor |
| Onset frames | 2 consecutive | Frames required before confirming speech has *started* (debounce) |
| Hangover frames | 5 consecutive | Silent frames required before confirming speech has *ended* (debounce) |

**Decision per frame:** `is_speech = (energy_dB > noise_floor_dB + 10) AND (zero_crossing_rate ≤ 0.6)`,
then smoothed by the onset/hangover counters above so a single flickering frame can't flip the
result.

### 3.3 Segmentation (`segmentation.py`)

| Parameter | Value | Purpose |
|---|---|---|
| Minimum pause | 0.3 s | Silence runs shorter than this are merged into the surrounding speech (standard clinical "IPU" — Inter-Pausal Unit — convention), so brief consonant gaps don't get counted as pauses |

### 3.4 Pitch tracking (`pitch.py`)

| Parameter | Value | Purpose |
|---|---|---|
| Frame / hop | 30ms / 10ms | Pitch analysis granularity |
| Search range | 75 Hz – 400 Hz | Valid human F0 range searched |
| Voicing threshold | 0.35 | Normalized autocorrelation peak must exceed this to accept the frame as voiced (pitched) |

**Method:** per frame, window (Hann) → FFT → autocorrelation via inverse-FFT of the power
spectrum → find the peak in the 75–400 Hz lag range → if the peak is strong enough, that lag
converts to F0 in Hz.

### 3.5 Syllable nuclei detection (`syllables.py`)

This is what the **articulation rate** (the single most important number for classification) is
built on — it counts syllables.

| Parameter | Value | Purpose |
|---|---|---|
| Intensity frame / hop | 32ms / 10ms | Granularity of the loudness (dB) contour |
| Smoothing | 50ms moving average | Smooths the contour before peak-picking |
| Silence threshold | window's max dB − 25 dB | Peaks quieter than this (relative to the loudest moment) are ignored |
| Minimum dip | 2 dB | A candidate peak must dip at least 2 dB from its neighbor on both sides to count as a *distinct* syllable, otherwise it's merged/rejected |
| Voicing required | yes | A peak must fall within 20ms of a voiced pitch frame — rejects consonant bursts (fricatives/plosives) and noise |
| Minimum interval | 0.08 s | Two nuclei closer than this are treated as re-detection jitter of the same syllable, not two syllables (implies a ~12.5 syll/s physiological ceiling) |

**Method** (De Jong & Wempe 2009, the standard Praat "speech rate" algorithm): build a smoothed
intensity contour → find local maxima above the silence threshold → walk them in time and reject
any that don't dip far enough from their neighbors → keep only ones near a voiced pitch frame. Each
surviving peak = one syllable nucleus.

---

## 4. Computed features (`features.py`) — the 13 original numbers per window

All 13 are recomputed and sent in every `metrics` frame. `syllables_in_window` and
`phonation_seconds_in_window` are internal to the two rate formulas below, not sent directly.

| # | Field (wire name) | Formula | Meaning |
|---|---|---|---|
| 1 | `articulationRateSPS` | `syllables_in_window ÷ phonation_seconds_in_window` (speech time only, pauses excluded) | **The classification signal.** Syllables per second of *actual talking* |
| 2 | `speechRateWPM` | `(syllables_in_window ÷ window_seconds) × 60 ÷ 1.4` | Syllables per second of *elapsed time* (pauses included), converted to words/min using 1.4 syllables/word (standard English approximation) |
| 3 | `averageSyllableDurationSec` | `phonation_seconds_in_window ÷ syllables_in_window` | Average length of one syllable |
| 4 | `interSyllableIntervalSec` | mean gap between consecutive syllable nuclei *within the same IPU* (session-to-date) | Rhythm — how far apart syllables land |
| 5 | `pauseDurationSec` | mean length of all pauses so far this session | Typical pause length |
| 6 | `pauseFrequencyPerMin` | `total_pause_count ÷ (elapsed_seconds ÷ 60)` | How often the patient pauses |
| 7 | `speechToPauseRatio` | `total_speech_seconds ÷ total_pause_seconds` | Balance of talking vs. silence |
| 8 | `interPausalUnitLengthSec` | `total_speech_seconds ÷ total_IPU_count` | Average length of a continuous speech run between pauses |
| 9 | `meanPitchHz` | mean F0 over voiced frames in the window | Average pitch |
| 10 | `pitchVariabilityHz` | std. deviation of F0 over voiced frames in the window | Pitch monotone vs. expressive |
| 11 | `loudnessDb` | mean energy (dB) of speech frames in the window | Loudness |
| 12 | `voiceActivityPercent` | `100 × total_speech_seconds ÷ elapsed_seconds` | % of session spent actually talking |
| 13 | `speechConsistency` | `clip(1 − CV(inter-syllable intervals), 0, 1)` where `CV` = coefficient of variation (std/mean) of same-IPU syllable gaps | Rhythmic steadiness (1.0 = perfectly even rhythm; defaults to 1.0 until enough gap samples exist, to avoid a false low reading early in a session) |

Two different accumulation windows are used deliberately:
- **Rate features (#1–3)** use only the trailing `ANALYSIS_WINDOW_SEC` (4s) — reacts quickly to how
  the patient is speaking *right now*, since this is what drives classification.
- **Rhythm/descriptive features (#4–8, #12–13)** accumulate over the **whole session** as running
  totals (O(1) memory) — more stable/meaningful as a session-to-date picture.
- **Pitch/loudness (#9–11)** are recomputed fresh from the current window only — they describe
  current physiological state, not a session average.

### Composite score (0–100)

```
rate_closeness   = 1 − min(1, |articulation_rate − baseline_rate| ÷ baseline_rate)
activity_gap      = |voice_activity_ratio − 0.6| ÷ 0.6        # 0.6 = typical conversational speech:pause ratio
activity_score     = 1 − min(1, activity_gap)

composite_score = 100 × [ 0.5 × rate_closeness  +  0.3 × speechConsistency  +  0.2 × activity_score ]
```
Weights: **50% how close the current rate is to the patient's baseline, 30% rhythmic consistency,
20% how close voice-activity% is to a "typical conversation" target (60%)**. This is a general
wellness/quality score — it is *not* what drives the Tachylalia/Bradylalia label (see §6), and the
dashboard/phone UIs show it only in the secondary/expandable panel, not the primary Live Session
view.

### 4.1 New derived parameters

| Field (wire name) | Formula | Meaning |
|---|---|---|
| `wordsPerLast30Sec` | nuclei in an *independent* trailing 30s ring buffer ÷ 1.4 | Updates on its own cadence, decoupled from the 4s classification window |
| `totalSyllablesSession` / `totalWordsSession` | session-cumulative nuclei count / ÷1.4 | Monotonically non-decreasing for the whole session |
| `rateTrend` | least-squares slope of `articulationRateSPS` over the last `TREND_WINDOW_COUNT` (4) windows, vs. elapsed time | Positive = accelerating rate (a supporting tachylalia/festination signal) |
| `meanPitchTrendHz` | same, for `meanPitchHz` | Positive = rising pitch — feeds the phone's pitch/tone alert |
| `timeInAbnormalStateSec` | elapsed time since the *confirmed* state most recently became TACHYLALIA/BRADYLALIA | Resets to 0 the moment NORMAL is reconfirmed |
| `recoveryTimeSec` | elapsed time from a `triggerFeedback=true` event to the next confirmed NORMAL | Emitted once per completed recovery; `null` otherwise |
| `loudnessVariabilityDb` | std. deviation of energy (dB) over speech frames in the window | Loudness steadiness, companion to `loudnessDb` |

`z_rate` / `z_pause` / `z_syll` / `compositeZ` / `sampleSufficient` are classifier outputs, not
features — see §6.2/§6.3.

---

## 5. Baseline / calibration (`baseline.py`, Part A)

**Calibration is now mandatory for a real session.** There is no silent fallback to a population
default — a patient who has never calibrated gets the `uncalibrated` classification (§6.1) until
they do, full stop.

### 5.1 Three baseline states

| State | `is_personal` | How it arises | Classification method used |
|---|---|---|---|
| **Uncalibrated** | n/a — baseline is `None` | No calibration on file, and `demoMode` is not set | Always emits `uncalibrated` (§6.1) — never tachylalia/bradylalia |
| **Personal** | `True` | Real audio calibration (§5.2) produced a usable std from ≥2 sub-window samples | z-score method (§6.2) |
| **Non-personal** | `False` | `demoMode`'s population default, *or* a legacy manual-rate calibration with no possible std | Fixed-multiplier fallback (§6.1), same math as before but with wider multipliers (1.55× / 0.55×, see §2) |

`demoMode` only ever substitutes the population default when there's no real calibration —
it must never be set for an actual patient session (gateway's `Session.demoMode`, threaded
through the `init` WS message).

### 5.2 Calibration recording → mean + std

A calibration attempt sends one or more clips (`referenceStats.clips`, preferably 2 short ~20s
readings — Part A.4: a single clip understates natural variability). Each clip is analyzed twice:

1. **Whole-clip pass** — same feature pipeline as live analysis (§4), run once over the entire
   clip, for descriptive stats (speech rate, pitch, loudness…) and the phonation-time gate below.
2. **Per-sub-window pass** — the clip is also sliced into independent `CALIBRATION_SUBWINDOW_SEC`
   (4s) chunks, each re-run through the *same* pipeline from scratch (no streaming state carried
   over, exactly like a live 4s window). Sub-windows with zero detected syllables are dropped.
   The surviving sub-windows' `articulationRateSPS`, `speechToPauseRatio`, and
   `averageSyllableDurationSec` values become the sample pool.

All clips' sample pools are concatenated (this is the "pooling" in Part A.4) and reduced to
mean + population std via `BaselineProfile.from_subwindow_samples`. `is_personal` is only `True`
if at least 2 pooled samples exist — a single sample's std is always 0 and would be meaningless.

> **Note on `baselinePauseRatio`:** unlike the pre-v2 population-default meaning (fraction of
> session time spent paused, 0–1), this field is now the **mean `speechToPauseRatio`** across
> calibration sub-windows — the same live feature the classifier's `z_pause` term compares
> against (§6.2). Keeping both sides of that z-score on the same scale is what keeps `z_pause`
> mathematically meaningful; the wire field name was kept for continuity with the gateway's
> `Profile` schema, only its unit changed.

### 5.3 Minimum calibration length

A calibration attempt is rejected (`422`, gateway forwards the message to the phone client) if
the **pooled phonation time across all submitted clips** is below `MIN_CALIBRATION_PHONATION_SEC`
(20s) — a plain 30s *recording* length was not enough of a guarantee, since a patient could pause
through most of it. The phone client's "Try Again" surfaces this and restarts the full 2-clip flow.

### 5.4 Fixed-multiplier thresholds (non-personal fallback, §6.1)

```
tachylalia_threshold  = baseline_articulation_rate × 1.55   (TACHYLALIA_MULTIPLIER)
bradylalia_threshold  = baseline_articulation_rate × 0.55   (BRADYLALIA_MULTIPLIER)
```
These are always computed (even for personal profiles, for display/fallback), but only actually
*used* to decide classification when `is_personal` is `False`.

---

## 6. Classification decision (`classifier.py`) — how the label is chosen

Still a **rule-based hysteresis state machine**, not a trained model — every number is a
deterministic function of the calibrated baseline and the current window's features. It runs once
per analysis window (every `MIN_EMIT_INTERVAL_SEC` ≈ 0.5s).

### 6.1 Step 1 — raw label for this window

```
if baseline is None:
    raw = UNCALIBRATED                      # §5.1 -- never tachylalia/bradylalia
elif not sample_sufficient:                 # §6.3
    raw = <carried forward from last confirmed state, unchanged>
elif baseline.is_personal:                  # §6.2, §5.1
    if disorderMode == "tachylalia":
        raw = TACHYLALIA if composite_z > Z_TACHYLALIA else NORMAL
    else:
        raw = BRADYLALIA if composite_z < -Z_BRADYLALIA else NORMAL
else:                                        # fixed-multiplier fallback, §5.4
    if disorderMode == "tachylalia":
        raw = TACHYLALIA if articulation_rate > tachylalia_threshold else NORMAL
    else:
        raw = BRADYLALIA if articulation_rate < bradylalia_threshold else NORMAL
```

### 6.2 Multi-parameter corroboration (composite z-score)

For **personal** baselines, the raw label no longer comes from articulation rate alone — a
composite z-score against the patient's own calibrated variance decides it:

```
z_rate  = (articulation_rate − baseline_rate) ÷ max(baseline_rate_std, BASELINE_STD_FLOOR)
z_pause = (speech_to_pause_ratio − baseline_pause_mean) ÷ max(baseline_pause_std, 0.1)
z_syll  = -(avg_syllable_duration − baseline_syll_mean) ÷ max(baseline_syll_std, 0.02)
          # negated: shorter syllables == faster speech == tachy direction,
          # matching z_rate/z_pause's "positive = tachy" sign convention

composite_z = 0.6·z_rate + 0.25·z_pause + 0.15·z_syll
```
The `max(std, floor)` denominators mean a near-zero personal std can never divide by ~0 or produce
NaN/Inf. `z_rate`, `z_pause`, `z_syll`, and `composite_z` are exposed in **every** metrics frame
(camelCase on the wire: `zRate`/`zPause`/`zSyll`/`compositeZ`), personal or not — non-personal
sessions get descriptive versions computed against the population-default std, purely for
display/audit; they don't drive the decision (§6.1's fallback branch does that off raw rate).

### 6.3 Minimum-sample gating

If the window has fewer than `MIN_SYLLABLES_PER_WINDOW` (4) syllables, or less than
`MIN_PHONATION_SEC_PER_WINDOW` (1.5s) of phonation, no raw label is computed from it at all — the
previous **confirmed** state is carried forward unchanged, and critically the hysteresis counters
are *not* reset (a borderline run of good windows isn't punished by one quiet one landing in the
middle). `sampleSufficient: false` is reported on that frame so downstream consumers know why the
state didn't move.

### 6.4 Step 2 — hysteresis confirmation + disorderMode scoping

Same idea as before — a per-label counter tracks consecutive raw-label windows, and the
classifier **confirms** a new state once the counter reaches the mode's `required_windows`
(`HYSTERESIS_WINDOWS` for a tachylalia-mode session, `HYSTERESIS_WINDOWS_BRADYLALIA` for a
bradylalia-mode one) — but now a session is opened in exactly one `disorderMode` (set once at
session start, from the phone's landing page) and §6.1's raw-label branch only ever evaluates
that single direction. **A tachylalia-mode session can never confirm bradylalia, and vice versa.**

### 6.5 Step 3 — confidence score (0–1)

```
corroboration = fraction of {z_rate, z_pause, z_syll} agreeing in sign with the raw label's
                direction (0, 0.33, 0.67, or 1.0)
sample_factor  = min(1, syllables_in_window ÷ (MIN_SYLLABLES_PER_WINDOW × 2))
progress       = min(1, consecutive_windows_of_current_raw_label ÷ required_windows)

confidence = clip(0.4·progress + 0.3·corroboration + 0.2·min(1, |composite_z| ÷ 4)
                   + 0.1·sample_factor, 0, 1)
```
Replaces the old persistence-plus-deviation formula with one that also rewards multiple
parameters agreeing (corroboration) and enough syllables actually being observed (sample_factor).

### 6.6 Step 4 — feedback (vibration) trigger

Unchanged in mechanism: fires on the confirming edge, then re-fires at most every
`FEEDBACK_REFRACTORY_SEC` (4s) while the confirmed state stays abnormal. The gateway now selects
the vibration *pattern* by the session's `disorderMode` (Part E.12) rather than by the specific
classification reason.

### 6.7 Output per window (metrics frame)

```jsonc
{
  "classification": "uncalibrated" | "normal" | "tachylalia" | "bradylalia",  // CONFIRMED state
  "confidence": 0.0–1.0,
  "triggerFeedback": true | false,
  "feedbackReason": "tachylalia" | "bradylalia" | null,
  "sampleSufficient": true | false,
  "zRate": number, "zPause": number, "zSyll": number, "compositeZ": number,
  // ...plus the 13 original features (§4) and the new derived parameters (§4.1)
}
```

---

## 7. Timing summary

| When | What happens |
|---|---|
| 0 – 1.0s of audio | Warmup — no output yet (`WARMUP_SEC`) |
| Every ≥0.5s after that | One analysis pass over the trailing 4s window → one metrics frame (`MIN_EMIT_INTERVAL_SEC`, `ANALYSIS_WINDOW_SEC`) |
| A deviation must hold for `required_windows` consecutive *sufficient* passes | Before `classification` actually changes — 3 for tachylalia, 5 for bradylalia (§6.4); insufficient-sample windows (§6.3) don't count against or toward this |
| Once abnormal | Vibration re-triggers at most every 4s (`FEEDBACK_REFRACTORY_SEC`) |

---

## 8. What is *not* machine learning

There is no trained model, no neural network, and no random/mocked data anywhere in this engine —
every field above is a deterministic function of the audio, built from classical DSP: Butterworth
filtering, spectral-subtraction denoising, energy+zero-crossing VAD, autocorrelation pitch
tracking, and De Jong & Wempe intensity-based syllable detection (§3, unchanged). The only
"learned" inputs are the patient's own **calibration baseline** (§5) — a measurement of that
patient, not a trained parameter — and the classifier's threshold constants (§2, §6.5), which are
hand-set defaults meant to be tuned against real accuracy data (§9), not fit by gradient descent.

---

## 9. Accuracy validation (`scripts/evaluate_accuracy.py`, Part G)

Every emitted metrics frame's decision inputs/outputs can be logged as JSONL by setting
`DEBUG_LOG_FRAMES=true` (writes to `DEBUG_LOG_DIR`, one `<sessionId>.jsonl` file per session) —
see `session_pipeline.py`'s `_log_frame_for_accuracy_eval`. Each line: window timestamp,
`articulationRateSPS`, `zRate`/`zPause`/`zSyll`/`compositeZ`, raw label, confirmed label,
confidence, `sampleSufficient`.

`scripts/evaluate_accuracy.py --session-log <path>.jsonl --ground-truth <path>.csv` scores the
confirmed label in that log against a clinician/tester-labeled ground truth (CSV columns
`start_sec,end_sec,label`, one row per reviewed time range) and prints a confusion matrix plus
per-class precision/recall/F1. This — not guesswork — is the intended way to retune
`Z_TACHYLALIA`, `Z_BRADYLALIA`, and the `composite_z`/confidence weights in §6.2/§6.5.
