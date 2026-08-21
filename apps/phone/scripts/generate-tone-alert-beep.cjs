// One-off generator for the tone alert's bundled beep asset (android/app/src/main/res/raw/tone_alert_beep.wav).
// Run with `node scripts/generate-tone-alert-beep.cjs`. Not part of the build -- the
// output WAV is committed and this script only needs to be re-run if the beep itself
// should change (duration, pitch, envelope).
const fs = require('fs');
const path = require('path');

const SAMPLE_RATE = 44100;
const DURATION_SEC = 0.18;
const FREQUENCY_HZ = 880;
const PEAK_AMPLITUDE = 0.22;
const FADE_SEC = 0.02;

const numSamples = Math.round(SAMPLE_RATE * DURATION_SEC);
const samples = new Int16Array(numSamples);

for (let i = 0; i < numSamples; i++) {
  const t = i / SAMPLE_RATE;
  const fadeIn = Math.min(1, t / FADE_SEC);
  const fadeOut = Math.min(1, (DURATION_SEC - t) / FADE_SEC);
  const envelope = Math.max(0, Math.min(fadeIn, fadeOut));
  const value = PEAK_AMPLITUDE * envelope * Math.sin(2 * Math.PI * FREQUENCY_HZ * t);
  samples[i] = Math.round(value * 32767);
}

const dataSize = samples.length * 2;
const buffer = Buffer.alloc(44 + dataSize);

buffer.write('RIFF', 0, 'ascii');
buffer.writeUInt32LE(36 + dataSize, 4);
buffer.write('WAVE', 8, 'ascii');
buffer.write('fmt ', 12, 'ascii');
buffer.writeUInt32LE(16, 16);
buffer.writeUInt16LE(1, 20);
buffer.writeUInt16LE(1, 22);
buffer.writeUInt32LE(SAMPLE_RATE, 24);
buffer.writeUInt32LE(SAMPLE_RATE * 2, 28);
buffer.writeUInt16LE(2, 32);
buffer.writeUInt16LE(16, 34);
buffer.write('data', 36, 'ascii');
buffer.writeUInt32LE(dataSize, 40);

for (let i = 0; i < samples.length; i++) {
  buffer.writeInt16LE(samples[i], 44 + i * 2);
}

const outPath = path.join(__dirname, '..', 'android', 'app', 'src', 'main', 'res', 'raw', 'tone_alert_beep.wav');
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, buffer);
console.log(`Wrote ${outPath} (${buffer.length} bytes, ${DURATION_SEC * 1000}ms @ ${FREQUENCY_HZ}Hz)`);
