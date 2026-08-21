// Central DSP tuning constants — ported verbatim from
// services/dsp-service/app/pipeline/constants.py (see
// CLASSIFICATION_ENGINE.md for the full derivation of every value here).
// Bradylalia-specific constants were removed: this build is tachylalia-only.

// --- Preprocessing ---
export const BANDPASS_LOW_HZ = 80.0;
export const BANDPASS_HIGH_HZ = 4000.0;
export const BANDPASS_ORDER = 4;

export const STFT_FRAME_SIZE = 512; // 32ms @ 16kHz
export const STFT_HOP_SIZE = 256; // 50% overlap, COLA-compatible with a Hann window

export const NOISE_UPDATE_PERCENTILE = 20.0;
// Raised from 1.5 (root-cause noise rejection, item 2): more aggressively
// subtracts the estimated stationary noise spectrum from every frame before
// VAD/pitch/nuclei ever see it, instead of just tightening downstream
// thresholds against noise that's still present in the signal.
// NOISE_SPECTRAL_FLOOR is intentionally left unchanged -- it's what keeps
// this from ever fully crushing genuine speech toward silence/musical-noise
// artifacts, which would otherwise also break the (now pre-AGC, see
// preprocessing.ts) loudness measurement.
export const NOISE_OVERSUBTRACTION_FACTOR = 1.8;
export const NOISE_SPECTRAL_FLOOR = 0.05;
export const NOISE_ESTIMATE_SMOOTHING = 0.9;

export const AGC_TARGET_RMS = 0.1;
export const AGC_MIN_GAIN = 0.2;
export const AGC_MAX_GAIN = 6.0;
export const AGC_SMOOTHING = 0.85;

// --- VAD ---
// ENERGY_MARGIN_DB/ZCR_MAX/ONSET_FRAMES all tightened (item 2, root-cause):
// require a bigger, more sustained gap above the tracked noise floor before
// confirming "this is speech" at all, rather than accepting borderline
// frames and hoping downstream feature gating catches the difference.
export const VAD_FRAME_MS = 20.0;
export const VAD_HOP_MS = 10.0;
export const VAD_ENERGY_MARGIN_DB = 14.0;
export const VAD_ZCR_MAX = 0.5;
export const VAD_NOISE_FLOOR_PERCENTILE = 15.0;
export const VAD_NOISE_FLOOR_WINDOW_SEC = 3.0;
export const VAD_ONSET_FRAMES = 3;
export const VAD_HANGOVER_FRAMES = 5;

// --- Segmentation ---
export const MIN_PAUSE_SEC = 0.3;

// --- Pitch tracking ---
export const PITCH_FRAME_MS = 30.0;
export const PITCH_HOP_MS = 10.0;
export const PITCH_MIN_HZ = 75.0;
export const PITCH_MAX_HZ = 400.0;
export const PITCH_VOICING_THRESHOLD = 0.35;

// --- Syllable nuclei detection (De Jong & Wempe) ---
export const NUCLEI_INTENSITY_FRAME_MS = 32.0;
export const NUCLEI_INTENSITY_HOP_MS = 10.0;
export const NUCLEI_SMOOTHING_MS = 50.0;
export const NUCLEI_SILENCE_THRESHOLD_DB = 25.0;
export const NUCLEI_MIN_DIP_DB = 2.0;
export const NUCLEI_BOUNDARY_GUARD_SEC = 0.1;
export const NUCLEI_REQUIRE_VOICING = true;
export const NUCLEI_MIN_INTERVAL_SEC = 0.08;

// --- Rate -> words/min conversion ---
export const SYLLABLES_PER_WORD = 1.4;

// --- Composite score weights ---
export const COMPOSITE_WEIGHT_RATE = 0.5;
export const COMPOSITE_WEIGHT_CONSISTENCY = 0.3;
export const COMPOSITE_WEIGHT_ACTIVITY = 0.2;
export const COMPOSITE_TARGET_VOICE_ACTIVITY = 0.6;

// --- Composite z-score weights (tachylalia direction only) ---
export const COMPOSITE_Z_WEIGHT_RATE = 0.6;
export const COMPOSITE_Z_WEIGHT_PAUSE = 0.25;
export const COMPOSITE_Z_WEIGHT_SYLL = 0.15;

// --- Confidence formula weights ---
export const CONFIDENCE_WEIGHT_PROGRESS = 0.4;
export const CONFIDENCE_WEIGHT_CORROBORATION = 0.3;
export const CONFIDENCE_WEIGHT_COMPOSITE_Z = 0.2;
export const CONFIDENCE_WEIGHT_SAMPLE = 0.1;
export const CONFIDENCE_COMPOSITE_Z_SCALE = 4.0;

// --- Trend regression ---
export const TREND_WINDOW_COUNT = 4;

// --- Words-per-30s ring buffer ---
export const WORDS_RING_BUFFER_SEC = 30.0;

// --- z-score denominator floors ---
export const PAUSE_RATIO_STD_FLOOR = 0.1;
export const SYLLABLE_DURATION_STD_FLOOR = 0.02;
export const INTER_SYLLABLE_INTERVAL_STD_FLOOR = 0.02;
export const PAUSE_DURATION_STD_FLOOR = 0.1;
export const PAUSE_FREQUENCY_STD_FLOOR = 1.0;
export const IPU_LENGTH_STD_FLOOR = 0.3;
export const MEAN_PITCH_STD_FLOOR = 5.0;
export const LOUDNESS_STD_FLOOR = 2.0;
export const VOICE_ACTIVITY_STD_FLOOR = 5.0;

export const EPS = 1e-10;

// Below this much elapsed recording time, a "0 pauses so far" reading is
// still just "not enough data yet" (N/A); at or beyond it, 0 completed
// pauses is treated as a genuine, meaningful finding for that metric.
export const MIN_ELAPSED_FOR_ZERO_METRIC_SEC = 2.0;

// --- Live VAD gating (Part A) ---
// A trailing analysis window with less than this much VAD-confirmed
// phonation is "not actually speech" for live-display purposes -- well
// below minPhonationSecPerWindow (the classifier's much stricter
// sample-sufficiency gate), this only exists to distinguish "genuinely no
// speech happened in this window" (freeze/suppress) from "some speech, just
// not quite enough to trust a classification decision" (still a real,
// freshly-computed reading).
export const MIN_LIVE_PHONATION_SEC = 0.05;

// --- Feedback (vibration) cadence (Part F) ---
// Gap between repeated tachylalia-alert firings while the patient stays
// continuously abnormal. The FIRST firing on a normal->abnormal transition
// is immediate (no hysteresis wait) -- this only throttles re-fires after
// that.
export const FEEDBACK_REFRACTORY_SEC = 4.0;

// --- Dual-threshold detection (Part D) ---
// Population-level normal reference ranges, independent of the patient's
// personal calibration. WORDS_PER_30SEC_TACHYLALIA_THRESHOLD is
// condition_2's trigger: wordsPerLast30Sec above this alone is sufficient
// to raise TACHYLALIA, regardless of composite_z.
export const WPM_NORMAL_MIN = 100;
export const WPM_NORMAL_MAX = 145;
export const WORDS_PER_30SEC_NORMAL_MIN = 50;
export const WORDS_PER_30SEC_NORMAL_MAX = 73;
export const WORDS_PER_30SEC_TACHYLALIA_THRESHOLD = WORDS_PER_30SEC_NORMAL_MAX;

// --- Tone (loudness) alert (Part G, item 5) ---
// The app's loudnessDb is real dBFS (0 = digital full scale, so readings
// are <= 0), computed pre-AGC (see preprocessing.ts's
// StreamingSpectralDenoiser.process() doc comment -- AGC normalizes RMS
// toward a fixed target, which would otherwise erase the loud-vs-quiet
// variation this alert exists to detect). The product spec's threshold
// ("65") is stated as an absolute dB-SPL-style value, matching the
// clinical convention that ~65dB SPL is a raised/loud speaking voice.
// There's no per-device mic calibration to convert dBFS to true SPL, so
// this offset is a fixed approximation (dBSPL ~= dBFS +
// LOUDNESS_SPL_OFFSET_DB) applied only for this alert's threshold check --
// it does not change the dBFS value shown on the Loudness param card.
export const LOUDNESS_SPL_OFFSET_DB = 100;
export const LOUDNESS_ALERT_SPL_THRESHOLD = 65;
export const LOUDNESS_ALERT_DBFS_THRESHOLD = LOUDNESS_ALERT_SPL_THRESHOLD - LOUDNESS_SPL_OFFSET_DB;

// --- Sanity bounds (Part C) ---
// A residual DSP bug must never be able to put a physically implausible
// number on a metrics frame -- these are a safety net on top of (not a
// replacement for) the root-cause fixes in features.ts/sessionPipeline.ts.
// A value outside its bound is treated as invalid for that window (held at
// the last valid value, same as Part A's VAD-silence freeze), never
// clamped-and-displayed.
export const ARTICULATION_RATE_MAX_SPS = 12.5;
export const SYLLABLE_DURATION_MIN_SEC = 0.05;
export const SYLLABLE_DURATION_MAX_SEC = 2.0;
export const INTER_SYLLABLE_INTERVAL_MIN_SEC = 0.05;
export const INTER_SYLLABLE_INTERVAL_MAX_SEC = 2.0;
export const LOUDNESS_REALISTIC_MIN_DBFS = -60.0;
export const LOUDNESS_REALISTIC_MAX_DBFS = 0.0;
