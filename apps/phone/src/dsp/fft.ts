// Minimal in-place radix-2 Cooley-Tukey complex FFT, plus the real-signal
// helpers the pipeline needs (rfft-style magnitude/phase spectrum,
// irfft-style reconstruction, and an autocorrelation-via-FFT helper for
// pitch tracking). All the sizes this module is ever called with
// (STFT_FRAME_SIZE=512, pitch fftLen=1024) are powers of two, so a plain
// radix-2 implementation is sufficient — no Bluestein fallback needed.

function isPowerOfTwo(n: number): boolean {
  return n > 0 && (n & (n - 1)) === 0;
}

/** In-place FFT (sign=-1 forward, sign=+1 inverse-unnormalized) on parallel re/im arrays of length n (power of two). */
function fftInPlace(re: Float64Array, im: Float64Array, sign: -1 | 1): void {
  const n = re.length;
  if (!isPowerOfTwo(n)) throw new Error(`fft size must be a power of two, got ${n}`);

  // Bit-reversal permutation.
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i]; re[i] = re[j]; re[j] = tr;
      const ti = im[i]; im[i] = im[j]; im[j] = ti;
    }
  }

  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1;
    const theta = (sign * 2 * Math.PI) / len;
    const wRe = Math.cos(theta);
    const wIm = Math.sin(theta);
    for (let start = 0; start < n; start += len) {
      let curRe = 1;
      let curIm = 0;
      for (let k = 0; k < half; k++) {
        const evenIdx = start + k;
        const oddIdx = start + k + half;
        const oRe = re[oddIdx] * curRe - im[oddIdx] * curIm;
        const oIm = re[oddIdx] * curIm + im[oddIdx] * curRe;
        re[oddIdx] = re[evenIdx] - oRe;
        im[oddIdx] = im[evenIdx] - oIm;
        re[evenIdx] += oRe;
        im[evenIdx] += oIm;
        const nextRe = curRe * wRe - curIm * wIm;
        const nextIm = curRe * wIm + curIm * wRe;
        curRe = nextRe;
        curIm = nextIm;
      }
    }
  }
}

export interface ComplexSpectrum {
  re: Float64Array;
  im: Float64Array;
}

/** Forward FFT of a real signal, zero-padded/truncated to `n` (power of two). Full complex spectrum, length n. */
export function fftReal(signal: ArrayLike<number>, n: number): ComplexSpectrum {
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  const len = Math.min(signal.length, n);
  for (let i = 0; i < len; i++) re[i] = signal[i];
  fftInPlace(re, im, -1);
  return { re, im };
}

/** Inverse FFT of a full complex spectrum (length n, power of two) -> real part only, normalized by 1/n. */
export function ifftRealPart(re: Float64Array, im: Float64Array): Float64Array {
  const n = re.length;
  const workRe = re.slice();
  const workIm = im.slice();
  fftInPlace(workRe, workIm, 1);
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = workRe[i] / n;
  return out;
}

/**
 * Real-signal autocorrelation via FFT: autocorr[k] = sum_i x[i]*x[i+k],
 * computed as ifft(fft(x) * conj(fft(x))), matching
 * `np.fft.irfft(spectrum * np.conj(spectrum), n=fft_len)[:frame_len]` in
 * pitch.py. Returns the first `outLen` lags.
 */
export function autocorrelationViaFFT(signal: ArrayLike<number>, fftLen: number, outLen: number): Float64Array {
  const { re, im } = fftReal(signal, fftLen);
  const powRe = new Float64Array(fftLen);
  const powIm = new Float64Array(fftLen);
  for (let i = 0; i < fftLen; i++) {
    // spectrum * conj(spectrum) = |spectrum|^2, purely real, but keep the
    // general complex multiply for clarity/symmetry with the python code.
    powRe[i] = re[i] * re[i] + im[i] * im[i];
    powIm[i] = 0;
  }
  const full = ifftRealPart(powRe, powIm);
  return full.slice(0, outLen);
}

/** rfft-style magnitude+phase over bins [0, n/2] of a real, windowed frame of length n. */
export function rfftMagPhase(frame: ArrayLike<number>, n: number): { mag: Float64Array; phase: Float64Array } {
  const { re, im } = fftReal(frame, n);
  const bins = n / 2 + 1;
  const mag = new Float64Array(bins);
  const phase = new Float64Array(bins);
  for (let i = 0; i < bins; i++) {
    mag[i] = Math.hypot(re[i], im[i]);
    phase[i] = Math.atan2(im[i], re[i]);
  }
  return { mag, phase };
}

/**
 * irfft-style reconstruction from magnitude+phase over bins [0, n/2] back
 * to a real time-domain frame of length n, via conjugate-symmetric
 * spectrum reconstruction + full inverse FFT (real part).
 */
export function irfftFromMagPhase(mag: ArrayLike<number>, phase: ArrayLike<number>, n: number): Float64Array {
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  const bins = n / 2 + 1;
  for (let i = 0; i < bins; i++) {
    re[i] = mag[i] * Math.cos(phase[i]);
    im[i] = mag[i] * Math.sin(phase[i]);
    if (i > 0 && i < n - i) {
      re[n - i] = re[i];
      im[n - i] = -im[i];
    }
  }
  return ifftRealPart(re, im);
}
