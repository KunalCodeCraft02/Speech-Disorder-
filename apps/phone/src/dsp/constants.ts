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
export const NOISE_OVERSUBTRACTION_FACTOR = 1.5;
export const NOISE_SPECTRAL_FLOOR = 0.05;
export const NOISE_ESTIMATE_SMOOTHING = 0.9;

export const AGC_TARGET_RMS = 0.1;
export const AGC_MIN_GAIN = 0.2;
export const AGC_MAX_GAIN = 6.0;
export const AGC_SMOOTHING = 0.85;

// --- VAD ---
export const VAD_FRAME_MS = 20.0;
export const VAD_HOP_MS = 10.0;
export const VAD_ENERGY_MARGIN_DB = 10.0;
export const VAD_ZCR_MAX = 0.6;
export const VAD_NOISE_FLOOR_PERCENTILE = 15.0;
export const VAD_NOISE_FLOOR_WINDOW_SEC = 3.0;
export const VAD_ONSET_FRAMES = 2;
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

export const EPS = 1e-10;
