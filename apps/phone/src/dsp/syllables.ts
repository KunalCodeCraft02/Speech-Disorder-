// Syllable nuclei detection via intensity-contour peak-picking (De Jong &
// Wempe 2009). Ported from services/dsp-service/app/pipeline/syllables.py.

import * as C from './constants';

function intensityContour(audio: Float32Array, sampleRate: number, startTime: number): { times: Float64Array; db: Float64Array } {
  const frameLen = Math.floor((sampleRate * C.NUCLEI_INTENSITY_FRAME_MS) / 1000);
  const hopLen = Math.floor((sampleRate * C.NUCLEI_INTENSITY_HOP_MS) / 1000);

  if (audio.length < frameLen) return { times: new Float64Array(0), db: new Float64Array(0) };

  const nFrames = 1 + Math.floor((audio.length - frameLen) / hopLen);
  const times = new Float64Array(nFrames);
  let db: Float64Array = new Float64Array(nFrames);

  for (let i = 0; i < nFrames; i++) {
    const pos = i * hopLen;
    let sumSq = 0;
    for (let j = 0; j < frameLen; j++) sumSq += audio[pos + j] * audio[pos + j];
    const rmsVal = Math.sqrt(sumSq / frameLen);
    db[i] = 20 * Math.log10(rmsVal + C.EPS);
    times[i] = startTime + (pos + frameLen / 2) / sampleRate;
  }

  const smoothFrames = Math.max(1, Math.round(C.NUCLEI_SMOOTHING_MS / C.NUCLEI_INTENSITY_HOP_MS));
  if (smoothFrames > 1) {
    db = movingAverageSame(db, smoothFrames);
  }

  return { times, db };
}

/** `np.convolve(db, ones(k)/k, mode="same")` equivalent. */
function movingAverageSame(x: Float64Array, k: number): Float64Array {
  const n = x.length;
  const out = new Float64Array(n);
  const padLeft = Math.floor((k - 1) / 2);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    let count = 0;
    for (let j = 0; j < k; j++) {
      const idx = i - padLeft + j;
      if (idx >= 0 && idx < n) {
        sum += x[idx];
        count++;
      }
    }
    // np.convolve with mode="same" divides by the full kernel length k, not
    // the number of in-bounds samples (implicit zero-padding at the edges).
    out[i] = sum / k;
    void count;
  }
  return out;
}

function localMaxima(db: Float64Array, silenceThreshold: number): number[] {
  const candidates: number[] = [];
  for (let i = 1; i < db.length - 1; i++) {
    if (db[i] > silenceThreshold && db[i] >= db[i - 1] && db[i] >= db[i + 1]) candidates.push(i);
  }

  const deduped: number[] = [];
  let i = 0;
  while (i < candidates.length) {
    let j = i;
    while (j + 1 < candidates.length && candidates[j + 1] - candidates[j] <= 2) j++;
    const group = candidates.slice(i, j + 1);
    let best = group[0];
    for (const idx of group) if (db[idx] > db[best]) best = idx;
    deduped.push(best);
    i = j + 1;
  }

  return deduped;
}

function applyMinDip(candidates: number[], db: Float64Array, minDipDb: number): number[] {
  const accepted: number[] = [];

  for (const idx of candidates) {
    if (accepted.length === 0) {
      accepted.push(idx);
      continue;
    }

    const prev = accepted[accepted.length - 1];
    let valley: number;
    if (idx > prev) {
      valley = Infinity;
      for (let k = prev; k <= idx; k++) valley = Math.min(valley, db[k]);
    } else {
      valley = db[idx];
    }
    const dipFromPrev = db[prev] - valley;
    const dipFromCurr = db[idx] - valley;

    if (dipFromPrev >= minDipDb && dipFromCurr >= minDipDb) {
      accepted.push(idx);
    } else if (db[idx] > db[prev]) {
      accepted[accepted.length - 1] = idx;
    }
  }

  return accepted;
}

function nearVoiced(t: number, voicedTimes: Float64Array, toleranceSec: number): boolean {
  if (voicedTimes.length === 0) return false;
  // Binary search for insertion point (searchsorted).
  let lo = 0;
  let hi = voicedTimes.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (voicedTimes[mid] < t) lo = mid + 1;
    else hi = mid;
  }
  let best = Infinity;
  for (const idx of [lo - 1, lo]) {
    if (idx >= 0 && idx < voicedTimes.length) best = Math.min(best, Math.abs(voicedTimes[idx] - t));
  }
  return best <= toleranceSec;
}

export function detectSyllableNuclei(
  audio: Float32Array,
  sampleRate: number,
  startTime = 0,
  voicedTimes: Float64Array | null = null,
  voicingToleranceSec = 0.02
): number[] {
  const { times, db } = intensityContour(audio, sampleRate, startTime);
  if (db.length < 3) return [];

  let maxDb = -Infinity;
  for (let i = 0; i < db.length; i++) maxDb = Math.max(maxDb, db[i]);
  const silenceThreshold = maxDb - C.NUCLEI_SILENCE_THRESHOLD_DB;

  const candidates = localMaxima(db, silenceThreshold);
  const accepted = applyMinDip(candidates, db, C.NUCLEI_MIN_DIP_DB);
  let nucleiTimes = accepted.map((i) => times[i]);

  if (C.NUCLEI_REQUIRE_VOICING && voicedTimes !== null) {
    if (voicedTimes.length > 0) {
      nucleiTimes = nucleiTimes.filter((t) => nearVoiced(t, voicedTimes, voicingToleranceSec));
    } else {
      nucleiTimes = [];
    }
  }

  return nucleiTimes;
}
