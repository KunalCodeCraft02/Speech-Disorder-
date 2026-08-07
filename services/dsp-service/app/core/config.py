from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Environment-driven configuration. Fails fast on invalid values via
    pydantic's type coercion — a misconfigured service should not boot."""

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    env: str = "development"
    log_level: str = "INFO"

    host: str = "0.0.0.0"
    port: int = 8000

    # Shared secret the gateway presents as `Authorization: Bearer <token>`.
    # Left empty in development — the service accepts unauthenticated
    # connections only when this is unset, never in production.
    dsp_service_token: str = ""

    # Audio contract with the gateway (see services/gateway/src/services/dspClient.js)
    sample_rate: int = 16000

    # Rolling window used for the "live" rate features that drive
    # classification (articulation rate, speech rate). See architecture §08.
    analysis_window_sec: float = 4.0
    min_emit_interval_sec: float = 0.5
    warmup_sec: float = 1.0

    # Hysteresis: consecutive analysis windows a deviation must persist for
    # before the classifier confirms a Tachylalia/Bradylalia state change.
    # Bradylalia gets its own (higher) bar — normal speech has more natural
    # rate dips than spikes, so a slow-down needs to persist longer before
    # it's trusted as real bradylalia rather than a normal pause/dip.
    hysteresis_windows: int = 3
    hysteresis_windows_bradylalia: int = 5
    feedback_refractory_sec: float = 4.0

    # Minimum-sample gating (Part B.7): a window with too little speech in
    # it produces an unreliable rate estimate and must not be allowed to
    # feed the classifier a raw label at all.
    min_syllables_per_window: int = 4
    min_phonation_sec_per_window: float = 1.5

    # z-score classification (Part B.5/B.6) — used only for sessions with a
    # *personal* calibrated std (see baseline.py, BaselineProfile.is_personal).
    z_tachylalia: float = 2.0
    z_bradylalia: float = 2.0  # magnitude; raw bradylalia fires when z_rate < -z_bradylalia
    baseline_std_floor: float = 0.15  # syll/s — floors baselineArticulationRateStd so z_rate can never divide by ~0

    # Population defaults used when a session has no calibrated Profile
    # (demoMode only — see baseline.py). Population sessions have no
    # personal std, so classification falls back to the fixed-multiplier
    # method below rather than the z-score method.
    default_baseline_articulation_rate: float = 4.4  # syllables/sec
    default_baseline_articulation_rate_std: float = 0.6  # syll/s, assumed population spread — descriptive only, not used to decide the fallback classification
    default_baseline_pause_ratio: float = 1.5  # mean speechToPauseRatio (speech:pause), NOT fraction-of-time-paused — see baseline.py docstring
    default_baseline_pause_ratio_std: float = 0.6
    default_baseline_syllable_duration_sec: float = 0.2  # seconds/syllable
    default_baseline_syllable_duration_std: float = 0.05

    # Widened from the original 1.35/0.65 — those misclassified normal
    # speech (especially slow-but-normal speech) as bradylalia too often.
    # Only used for demoMode/population-default sessions; personal-std
    # sessions use the z-score method instead.
    tachylalia_multiplier: float = 1.55
    bradylalia_multiplier: float = 0.55

    # Calibration (Part A)
    min_calibration_phonation_sec: float = 20.0  # reject a calibration clip/pool with less actual speech than this
    calibration_subwindow_sec: float = 4.0  # sub-window size used to estimate std during calibration — matches analysis_window_sec by default

    # Accuracy validation (Part G) — every emitted metrics frame's decision
    # inputs (timestamp, z-scores, raw vs. confirmed label, confidence,
    # sampleSufficient) get appended as JSONL when enabled, so
    # scripts/evaluate_accuracy.py has something to score against a
    # clinician-labeled ground-truth CSV. Off by default — this is a
    # debugging/tuning aid, not something a production session needs.
    debug_log_frames: bool = False
    debug_log_dir: str = "./logs/dsp-frames"

    cors_origins: str = "*"

    @property
    def cors_origin_list(self) -> list[str]:
        if self.cors_origins == "*":
            return ["*"]
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
