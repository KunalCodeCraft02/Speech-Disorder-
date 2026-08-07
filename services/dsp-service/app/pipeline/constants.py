"""Central DSP tuning constants. Grouped here so the pipeline's behavior can
be audited/tuned in one place rather than hunting through each module."""

# --- Preprocessing ---
BANDPASS_LOW_HZ = 80.0
BANDPASS_HIGH_HZ = 4000.0
BANDPASS_ORDER = 4

STFT_FRAME_SIZE = 512  # 32ms @ 16kHz
STFT_HOP_SIZE = 256  # 50% overlap, COLA-compatible with a Hann window

NOISE_UPDATE_PERCENTILE = 20.0  # frames below this energy percentile update the noise estimate
NOISE_OVERSUBTRACTION_FACTOR = 1.5
NOISE_SPECTRAL_FLOOR = 0.05  # fraction of original magnitude retained at minimum
NOISE_ESTIMATE_SMOOTHING = 0.9  # EMA weight on the existing estimate

AGC_TARGET_RMS = 0.1
AGC_MIN_GAIN = 0.2
AGC_MAX_GAIN = 6.0
AGC_SMOOTHING = 0.85  # EMA weight on the previous gain (attack/release)

# --- VAD ---
VAD_FRAME_MS = 20.0
VAD_HOP_MS = 10.0
VAD_ENERGY_MARGIN_DB = 10.0  # speech must exceed noise floor by this much
VAD_ZCR_MAX = 0.6  # frames noisier than this (relative to Nyquist) are rejected regardless of energy
VAD_NOISE_FLOOR_PERCENTILE = 15.0
VAD_NOISE_FLOOR_WINDOW_SEC = 3.0
VAD_ONSET_FRAMES = 2  # consecutive speech frames required to confirm onset
VAD_HANGOVER_FRAMES = 5  # consecutive silence frames required to confirm offset

# --- Segmentation ---
MIN_PAUSE_SEC = 0.3  # silence runs shorter than this are merged into speech (clinical IPU convention)

# --- Pitch tracking ---
PITCH_FRAME_MS = 30.0
PITCH_HOP_MS = 10.0
PITCH_MIN_HZ = 75.0
PITCH_MAX_HZ = 400.0
PITCH_VOICING_THRESHOLD = 0.35  # normalized autocorrelation peak required to accept a frame as voiced

# --- Syllable nuclei detection (De Jong & Wempe style intensity peak-picking) ---
NUCLEI_INTENSITY_FRAME_MS = 32.0
NUCLEI_INTENSITY_HOP_MS = 10.0
NUCLEI_SMOOTHING_MS = 50.0
NUCLEI_SILENCE_THRESHOLD_DB = 25.0  # peaks below (window max - this) are ignored
NUCLEI_MIN_DIP_DB = 2.0  # minimum dB dip on both sides required to accept a peak as distinct
NUCLEI_BOUNDARY_GUARD_SEC = 0.1  # defer accepting peaks this close to the trailing window's right edge
NUCLEI_REQUIRE_VOICING = True
NUCLEI_MIN_INTERVAL_SEC = 0.08  # a peak re-estimated within this long of the cursor is boundary jitter, not a new syllable (~12.5 syll/s ceiling, above any physiological rate)

# --- Rate → words/min conversion ---
SYLLABLES_PER_WORD = 1.4  # standard English approximation

# --- Composite score weights (see features.py for the formula) ---
COMPOSITE_WEIGHT_RATE = 0.5
COMPOSITE_WEIGHT_CONSISTENCY = 0.3
COMPOSITE_WEIGHT_ACTIVITY = 0.2
COMPOSITE_TARGET_VOICE_ACTIVITY = 0.6  # typical conversational speech/pause ratio

# --- Composite z-score weights (classifier.py, Part B.6) — fixed, not env-tunable
# (evaluate_accuracy.py is the intended tool for retuning these, per Part G) ---
COMPOSITE_Z_WEIGHT_RATE = 0.6
COMPOSITE_Z_WEIGHT_PAUSE = 0.25
COMPOSITE_Z_WEIGHT_SYLL = 0.15

# --- Confidence formula weights (classifier.py Step 3, Part B.9) ---
CONFIDENCE_WEIGHT_PROGRESS = 0.4
CONFIDENCE_WEIGHT_CORROBORATION = 0.3
CONFIDENCE_WEIGHT_COMPOSITE_Z = 0.2
CONFIDENCE_WEIGHT_SAMPLE = 0.1
CONFIDENCE_COMPOSITE_Z_SCALE = 4.0  # |composite_z| this large or more maxes out that term

# --- Trend regression (features.py: rateTrend, meanPitchTrendHz) ---
TREND_WINDOW_COUNT = 4  # slope computed over up to the last N windows

# --- Words-per-30s ring buffer (features.py: wordsPerLast30Sec) ---
WORDS_RING_BUFFER_SEC = 30.0

# --- z-score denominator floors for the non-rate composite_z components
# (classifier.py). baseline_std_floor (config.py, env-overridable) covers
# articulation rate specifically per the spec; these cover the other two
# on their own natural scales so the same near-zero-std divide-by-zero
# can't happen there either. ---
PAUSE_RATIO_STD_FLOOR = 0.1  # speechToPauseRatio units
SYLLABLE_DURATION_STD_FLOOR = 0.02  # seconds

EPS = 1e-10
