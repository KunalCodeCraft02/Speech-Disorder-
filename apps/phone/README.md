# Speech Biofeedback — Offline Phone PWA

A single-screen, installable, **fully offline** web app: opens on a phone
browser (or installed as a PWA / Android APK), captures mic audio, analyzes
it **entirely on-device**, and buzzes the phone via `navigator.vibrate()`
when it detects tachylalia (speaking too fast). There is no backend, no
account, and no network call anywhere in the calibration or live-session
path — everything after the first page load works in airplane mode.

This collapses what used to be a 4-service system (a separate dashboard
app, a Node gateway, a Python FastAPI DSP service, and MongoDB — all
deleted) into this one app. The DSP math itself is unchanged: each
`src/dsp/*.ts` module is a line-for-line port of the original Python
pipeline, with the same formulas, constants, and decision logic documented
inline as comments. Bradylalia support was removed: this build is
**tachylalia-only**.

## Getting started

```bash
npm install
npm run dev
```

Open the printed URL **on a phone, or Chrome DevTools' device emulation**
(mic capture needs either `https://` or `localhost`). No sign-in, no
backend to start — tap **Calibrate** once, then **Start**.

## How it works

1. **Calibration** (`/calibrate`, once): records two ~20s readings, runs
   them through the same DSP pipeline used live, and derives a personal
   baseline (mean + std of articulation rate, pause ratio, syllable
   duration). Stored in IndexedDB (`src/storage/calibration.ts`) — persists
   across reloads until you explicitly recalibrate.
2. **Live session** (`/`, single screen): `AudioWorkletNode`
   (`public/worklets/pcm-capture-processor.js`) captures native-rate audio,
   `src/lib/pcm.ts` resamples it to 16kHz (in **either** direction — most
   phone mics run at 44.1/48kHz, but Bluetooth earpods over HFP/SCO often
   report 8kHz or 16kHz natively), and `src/dsp/sessionPipeline.ts` runs the
   full preprocessing → VAD → segmentation → pitch → syllable-nuclei →
   feature-extraction → hysteresis-classification pipeline in-process,
   emitting a metrics frame roughly every 0.5s. The classification ring,
   full primary parameter set (articulation rate, speech rate, syllable
   duration, inter-syllable interval, pause duration/frequency,
   speech:pause ratio, IPU length, cumulative words/syllables), and an
   expandable detail panel (z-scores, confidence, trends) are all on this
   one screen.
3. **Feedback**: a confirmed tachylalia state fires
   `navigator.vibrate([80, 60, 80, 60, 80])`; browsers without the
   Vibration API (iOS Safari) get a visual flash + synthesized beep instead
   (`src/lib/beep.ts`).
4. **Today** (`/today`): each completed session's summary (duration, avg
   articulation rate, time spent in tachylalia, feedback-trigger count) is
   saved locally (`src/storage/sessions.ts`), tagged by calendar date. This
   screen computes a plain-language end-of-day insight
   (`src/storage/insights.ts`) — practice time, % time too fast, and
   whether today's average rate moved closer to or further from baseline
   than yesterday.

## Offline / PWA

`vite-plugin-pwa` (see `vite.config.ts`) precaches the entire app shell —
JS/CSS/HTML plus the AudioWorklet module — into a service worker, installed
on first load. After that, the app (including a fresh calibration or live
session) works with the network fully off. Install it via the browser's
"Add to Home Screen" / install prompt, or use the packaged Android APK
below.

## Building an Android APK

The app is wrapped with [Capacitor](https://capacitorjs.com) — see
`capacitor.config.ts` and the committed `android/` native project.
Microphone access inside the Capacitor WebView needs three things working
together (all already wired up in `android/app/src/main/java/.../MainActivity.java`
and `AndroidManifest.xml`): the manifest `RECORD_AUDIO` permission, a
runtime permission grant, and a `WebChromeClient.onPermissionRequest`
override.

Locally (requires the Android SDK + JDK 17):

```bash
npm run build
npx cap sync android
cd android && ./gradlew assembleDebug
```

Or let CI build it: `.github/workflows/build-apk.yml` runs on every push to
`apps/phone/**` (and manually via `workflow_dispatch`), producing a
downloadable debug APK artifact — see that file's header comment for how to
switch to a signed release build.

## Verifying changes

No test suite is wired up yet (`npm run build` — type-check + production
build — and `npm run lint` are the only checks today). The DSP port in
`src/dsp/` is exactly the kind of logic that would benefit from a Vitest
unit suite mirroring `services/dsp-service`'s old `tests/unit/` (synthetic
sine-burst utterances, one file per pipeline stage) if you want to add one.

## Structure

```
src/
  dsp/            ported TypeScript DSP pipeline (preprocessing, VAD,
                  segmentation, pitch, syllable-nuclei, features, baseline,
                  hysteresis classifier, session orchestrator)
  storage/        IndexedDB — calibration profile, session summaries,
                  end-of-day insight computation
  lib/            pcm resampling/chunking, calibration engine, beep fallback
  hooks/          useAudioCapture, useLiveSession, useCalibrationRecorder,
                  useCalibrationProfile, usePitchAlert
  components/     classification ring, metrics tiles, calibration summary
  pages/          LiveSessionPage, CalibrationPage, TodayPage
android/          Capacitor native Android project (committed — customize
                  permissions/icons/splash here)
```
