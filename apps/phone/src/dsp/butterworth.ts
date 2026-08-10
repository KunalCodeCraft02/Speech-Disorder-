// Digital Butterworth bandpass filter design, as a cascade of biquad
// (second-order) sections — a TypeScript equivalent of
// `scipy.signal.butter(order, [low, high], btype="band", output="sos")`
// used by services/dsp-service/app/pipeline/preprocessing.py's
// BandpassFilter. Same design method (analog Butterworth lowpass
// prototype -> lowpass-to-bandpass frequency transform -> bilinear
// transform -> second-order-section cascade), not a byte-identical
// coefficient match to scipy — the runtime changed, the DSP method didn't.
//
// For BANDPASS_ORDER=4 this produces exactly 4 second-order sections,
// matching scipy's `butter(4, ..., btype="band", output="sos")` shape.

interface Complex {
  re: number;
  im: number;
}

const c = (re: number, im = 0): Complex => ({ re, im });
const cAdd = (a: Complex, b: Complex): Complex => c(a.re + b.re, a.im + b.im);
const cSub = (a: Complex, b: Complex): Complex => c(a.re - b.re, a.im - b.im);
const cMul = (a: Complex, b: Complex): Complex => c(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re);
const cScale = (a: Complex, k: number): Complex => c(a.re * k, a.im * k);
const cDiv = (a: Complex, b: Complex): Complex => {
  const denom = b.re * b.re + b.im * b.im;
  return c((a.re * b.re + a.im * b.im) / denom, (a.im * b.re - a.re * b.im) / denom);
};

/** Principal complex square root. */
function cSqrt(a: Complex): Complex {
  const r = Math.hypot(a.re, a.im);
  const re = Math.sqrt((r + a.re) / 2);
  let im = Math.sqrt(Math.max(0, (r - a.re) / 2));
  if (a.im < 0) im = -im;
  return c(re, im);
}

export interface Biquad {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number; // a0 is normalized to 1
}

/** Direct Form II Transposed biquad with persistent state, matching sosfilt's per-section streaming behavior (zero initial state, matching this codebase's `sosfilt_zi(sos) * 0.0`). */
export class BiquadFilter {
  private readonly coeffs: Biquad;
  private z1 = 0;
  private z2 = 0;

  constructor(coeffs: Biquad) {
    this.coeffs = coeffs;
  }

  processSample(x: number): number {
    const { b0, b1, b2, a1, a2 } = this.coeffs;
    const y = b0 * x + this.z1;
    this.z1 = b1 * x - a1 * y + this.z2;
    this.z2 = b2 * x - a2 * y;
    return y;
  }
}

/** Cascade of biquad sections, each with its own persistent state — the TS equivalent of scipy's `sosfilt(sos, x, zi=...)`. */
export class BiquadCascade {
  private readonly stages: BiquadFilter[];

  constructor(sos: Biquad[]) {
    this.stages = sos.map((coeffs) => new BiquadFilter(coeffs));
  }

  process(input: Float32Array): Float32Array {
    const out = new Float32Array(input.length);
    for (let i = 0; i < input.length; i++) {
      let sample = input[i];
      for (const stage of this.stages) sample = stage.processSample(sample);
      out[i] = sample;
    }
    return out;
  }
}

/** Butterworth lowpass analog prototype poles (unity cutoff, rad/s), left-half-plane, order N. */
function butterworthLowpassPrototypePoles(order: number): Complex[] {
  const poles: Complex[] = [];
  for (let k = 1; k <= order; k++) {
    const theta = ((2 * k - 1) * Math.PI) / (2 * order);
    poles.push(c(-Math.sin(theta), Math.cos(theta)));
  }
  return poles;
}

/**
 * Designs a digital Butterworth bandpass filter as a cascade of `order`
 * biquad sections. `order` here matches scipy's `N` argument to
 * `butter(N, ..., btype="band")` (an overall 2N-order bandpass built from
 * N second-order sections).
 */
export function designBandpassButterworth(order: number, lowHz: number, highHz: number, sampleRate: number): Biquad[] {
  const nyquist = sampleRate / 2;
  const low = Math.min(lowHz, nyquist * 0.98);
  const high = Math.min(highHz, nyquist * 0.99);

  // Bilinear-transform pre-warping of the digital edge frequencies to analog (rad/s).
  const fs2 = 2 * sampleRate;
  const wLow = fs2 * Math.tan((Math.PI * low) / sampleRate);
  const wHigh = fs2 * Math.tan((Math.PI * high) / sampleRate);
  const bw = wHigh - wLow;
  const w0Sq = wLow * wHigh;

  // Only the upper-half-plane prototype poles are needed — each produces a
  // conjugate-symmetric quartet of bandpass poles, i.e. two biquad sections.
  const prototypePoles = butterworthLowpassPrototypePoles(order).filter((p) => p.im >= 0);

  const sections: Biquad[] = [];

  for (const p of prototypePoles) {
    // Lowpass-to-bandpass transform: s -> (s^2 + w0^2) / (BW*s), applied to
    // pole p: solve s^2 - BW*p*s + w0^2 = 0 for the two bandpass poles.
    const bwP = cScale(p, bw);
    const discriminant = cSub(cMul(bwP, bwP), c(4 * w0Sq));
    const sqrtDisc = cSqrt(discriminant);
    const s1 = cScale(cAdd(bwP, sqrtDisc), 0.5);
    const s2 = cScale(cSub(bwP, sqrtDisc), 0.5);

    for (const sAnalog of [s1, s2]) {
      // Bilinear transform: z = (2*fs + s) / (2*fs - s).
      const z = cDiv(cAdd(c(fs2), sAnalog), cSub(c(fs2), sAnalog));
      // Denominator from this pole and its conjugate: z^2 - 2*Re(z)*z + |z|^2.
      const a1 = -2 * z.re;
      const a2 = z.re * z.re + z.im * z.im;
      // Numerator: (z-1)(z+1) = z^2 - 1 (zeros at DC and Nyquist), gain applied later.
      sections.push({ b0: 1, b1: 0, b2: -1, a1, a2 });
    }
  }

  normalizeUnityGainAtCenter(sections, Math.sqrt(low * high), sampleRate);
  return sections;
}

/** Evaluates one biquad section's transfer function at digital frequency z = exp(j*omega). */
function sectionResponse(section: Biquad, omega: number): Complex {
  const zInv1 = c(Math.cos(omega), -Math.sin(omega));
  const zInv2 = cMul(zInv1, zInv1);
  const numerator = cAdd(cAdd(c(section.b0), cScale(zInv1, section.b1)), cScale(zInv2, section.b2));
  const denominator = cAdd(cAdd(c(1), cScale(zInv1, section.a1)), cScale(zInv2, section.a2));
  return cDiv(numerator, denominator);
}

/** Scales the cascade so |H(z)| = 1 at the passband's geometric-center frequency. */
function normalizeUnityGainAtCenter(sections: Biquad[], centerHz: number, sampleRate: number): void {
  const omega = (2 * Math.PI * centerHz) / sampleRate;
  let totalRe = 1;
  let totalIm = 0;
  for (const section of sections) {
    const resp = sectionResponse(section, omega);
    const nextRe = totalRe * resp.re - totalIm * resp.im;
    const nextIm = totalRe * resp.im + totalIm * resp.re;
    totalRe = nextRe;
    totalIm = nextIm;
  }
  const mag = Math.hypot(totalRe, totalIm);
  if (mag > 1e-12 && sections.length > 0) {
    sections[0].b0 /= mag;
    sections[0].b1 /= mag;
    sections[0].b2 /= mag;
  }
}
