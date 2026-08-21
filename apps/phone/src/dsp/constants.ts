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
//
// Regression-fix note: this and VAD_ENERGY_MARGIN_DB/VAD_ZCR_MAX below were
// suspected culprits for a later over-sensitivity regression, but git
// history shows neither this value nor the two VAD ones were ever eased
// after this commit -- they're unchanged since the tightening above, still
// at their strict values. Left as-is here; the actual regression traced to
// the loudness-averaging bug fix legitimately raising loudnessDb (see
// LOUDNESS_THRESHOLD_DBFS below) and to zTachylalia's 2.0->1.5 retune
// (config.ts), not to noise/VAD leniency.
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
/** Item 1/6: floor for zWordsPer30Sec's denominator (words/30s units, same scale as WORDS_PER_30SEC_NORMAL_MIN/MAX below). */
export const WORDS_PER_30SEC_STD_FLOOR = 4.0;

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

// --- Feedback (vibration) cadence (Part F, item 3/4) ---
// Gap between repeated tachylalia-alert firings while the patient stays
// continuously abnormal. The FIRST firing on a normal->abnormal transition
// is immediate (no hysteresis wait) -- this only throttles re-fires after
// that.
export const FEEDBACK_REFRACTORY_SEC = 4.0;
// Item 3/4: how much real time a raw label can dip below threshold and
// still count as "the same episode" for cooldown-reset purposes -- without
// this, noisy oscillation right at the boundary (crossing back and forth
// within a second or two) resets the cooldown on every single dip below
// threshold, so the very next crossing back above fires an immediate
// re-buzz instead of respecting the refractory gap. A genuine return to
// normal that holds for longer than this DOES reset the cooldown, so the
// next real onset still fires immediately rather than being throttled by a
// stale timer from a previous episode. Applies to both the tachylalia
// alert (classifier.ts) and the tone alert (useToneAlert.ts).
export const FEEDBACK_EPISODE_GAP_TOLERANCE_SEC = 1.5;

// --- Dual-threshold detection (Part D, item 1/6) ---
// WPM_NORMAL_MIN/MAX and WORDS_PER_30SEC_NORMAL_MIN/MAX are population
// reference ranges, shown for context on the calibration screen -- purely
// descriptive now. condition_2 itself no longer compares against these:
// it's zWordsPer30Sec (wordsPerLast30Sec measured against the patient's
// own calibrated baselineWordsPer30Sec/-Std, see baseline.ts) against the
// SAME config.ts zTachylalia margin condition_1 uses (item 1: "the gap
// above the patient's calibrated baseline," for both conditions,
// configurable in one place). MAX values nudged down slightly (item 4,
// ~5%) so the displayed reference range stays consistent with the
// direction of the zTachylalia retune above -- a small adjustment, not a
// large drop.
export const WPM_NORMAL_MIN = 105;
export const WPM_NORMAL_MAX = 143;
export const WORDS_PER_30SEC_NORMAL_MIN = 55;
export const WORDS_PER_30SEC_NORMAL_MAX = 74;

// --- Tone (loudness) alert (Part G, item 2/5) ---
// The app's loudnessDb is real dBFS (0 = digital full scale, so readings
// are <= 0), computed pre-AGC (see preprocessing.ts's
// StreamingSpectralDenoiser.process() doc comment -- AGC normalizes RMS
// toward a fixed target, which would otherwise erase the loud-vs-quiet
// variation this alert exists to detect).
//
// This used to be derived from a separate "65 dB SPL"-style number via a
// +100dB fixed offset approximation -- that indirection was confusing (the
// configured "65" wasn't the same number as what the Loudness card
// actually shows) and, worse, the resulting -35dBFS cutoff was far louder
// than this app's real observed signal ever reaches (~-59dBFS at genuinely
// loud speech on real-device testing), so the alert could never fire.
// LOUDNESS_THRESHOLD_DBFS is now a single, direct cutoff in the exact same
// units/scale as the Loudness param card -- no conversion, what you see on
// the card is what's compared against this number.
//
// Retuned -55.0 -> -33.0 (regression fix): that -59dBFS "genuinely loud"
// reference number was measured through features.ts's windowedLoudnessDb
// BEFORE its averaging-bug fix (see the RunningStats.windowedLoudnessDb
// doc comment) -- the old naive dB-arithmetic-mean let near-silent
// micro-moments (unvoiced consonants, inter-syllable gaps) drag every
// window's average down toward -100/-200dB territory, so a real "loud
// speech" window's reported average was itself artificially quiet. Now
// that those outliers are filtered out and the rest is averaged correctly
// in linear power domain, the SAME actual loudness reads meaningfully
// higher (less negative) than before -- confirmed via synthetic
// end-to-end SessionPipeline tests (same methodology as the averaging-fix
// commit): a calibrated-normal speaking baseline landed around -37dBFS,
// well above the old -55 cutoff, so the tone alert was firing on
// essentially all speech regardless of actual loudness, not just genuinely
// loud stretches. -33.0 restores real separation between normal and loud
// speech in that synthetic test (clean margin held from -36 down to -28:
// calibrated-normal speech landed a comfortable ~4dB under the cutoff,
// genuinely loud speech a comfortable ~10dB over it), but the exact number
// is inherently device/mic/room dependent and MUST be confirmed on a real
// device per the classification engine's testing checklist: read the live
// Loudness param card's dBFS (same units this constant is compared
// against) while speaking at a normal conversational volume vs. genuinely
// raising your voice, and set this value a few dB above the normal
// reading and a few dB below the loud one.
export const LOUDNESS_THRESHOLD_DBFS = -33.0;

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
