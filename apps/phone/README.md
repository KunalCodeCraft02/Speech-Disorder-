# Speech Biofeedback — Phone Interface

A simple, single-screen "wearable" web UI: opens on a phone browser, captures
mic audio, streams it to the gateway as 16kHz PCM16 over Socket.IO, and buzzes
the phone via `navigator.vibrate()` when the server detects tachylalia
(too fast) or bradylalia (too slow). No graphs — just connection status,
recording status, current classification, and two large Start/Stop buttons.

## Getting started

```bash
npm install
cp .env.example .env   # already done — demo mode is on by default
npm run dev
```

Open the printed URL **on a phone, or Chrome DevTools' device emulation**
(mic capture needs either `https://` or `localhost` — the dev server is
`http://localhost`, which browsers treat as a secure context). Sign in with
any email/password in demo mode, tap **Start**, grant the microphone
permission prompt, and watch Connection/Recording status and Current
Classification update. In demo mode, classification cycles automatically and
occasionally fires a vibration — no backend needed.

## How the capture pipeline works

1. **Start** tapped → `AudioContext` created synchronously in the click
   handler (required by mobile autoplay/gesture policy) → `getUserMedia`
   requests the mic.
2. An `AudioWorkletNode` (`public/worklets/pcm-capture-processor.js`) buffers
   the mic's native-rate Float32 samples into 2048-sample blocks on the audio
   thread and posts them to the main thread.
3. `src/lib/pcm.ts` downsamples each block to 16kHz (averaging decimation —
   not a full anti-aliasing filter, but adequate for speech-rate/pitch/
   loudness analysis) and converts it to signed PCM16.
4. A `PCMChunker` accumulates that into ~250ms / 8000-byte frames and emits
   each as a binary `audio:chunk` on the `/device` Socket.IO namespace.
5. `vibration:command` events from the server call `navigator.vibrate(pattern)`
   immediately.

## Demo mode vs. the real backend

`VITE_DEMO_MODE=true` (default) runs entirely against an in-browser
simulator (`src/lib/demo.ts`) emitting the same event names/payloads the
real gateway does — mic capture is still real, only the socket side is
simulated. To use the real stack:

```
VITE_DEMO_MODE=false
VITE_API_URL=http://localhost:4000/api/v1
VITE_SOCKET_URL=http://localhost:4000
```

...and make sure `services/gateway`'s `CORS_ORIGIN` includes this app's dev
origin, and `services/dsp-service` + `services/gateway` are both running.

## Backend contract

Wired against `services/gateway`'s actual `/device` namespace (session
start/stop, binary `audio:chunk`, `vibration:command`) — see
`src/lib/socket.ts` and `src/hooks/useDeviceSession.ts`. Current
Classification is read by also self-subscribing to the `/dashboard`
namespace's `metrics:update` for this session — patients are authorized to
view their own dashboard channel (`socketAuth`'s `canViewUser` in
`dashboard.handler.js`), so this needed no backend change.
