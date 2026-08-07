# Speech Biofeedback Dashboard

A real-time clinician/patient dashboard for the speech biofeedback system —
dark medical theme, live gauges, waveform, trend graphs, classification,
composite score, session history and calibration summary.

Built with React 19 + TypeScript + Vite, TailwindCSS v4, Recharts, Framer
Motion, Socket.IO Client, and TanStack React Query.

## Getting started

```bash
npm install
cp .env.example .env   # already done — demo mode is on by default
npm run dev
```

Open the printed local URL (Vite picks the next free port from 5173 up) and
sign in with any email/password — demo mode accepts anything.

## Demo mode vs. the real backend

By default (`VITE_DEMO_MODE=true` in `.env`) the dashboard runs entirely in
the browser against an in-memory simulator (`src/lib/demo.ts`) that emits the
**same event names and payload shapes** the real backend does, so no part of
the UI knows the difference. This is for UI development and demos without
standing up Mongo/Redis/FastAPI.

To point it at the real stack instead:

1. Start `services/dsp-service` (FastAPI) and `services/gateway` (Node) per
   their own READMEs.
2. Set in `.env`:
   ```
   VITE_DEMO_MODE=false
   VITE_API_URL=http://localhost:4000/api/v1
   VITE_SOCKET_URL=http://localhost:4000
   ```
3. Sign in with a real account registered via the gateway's `/auth/register`.

## Backend contract

This app is wired against `services/gateway`'s actual contracts — no
guessing:

- **REST** (`/api/v1`): `/auth/login`, `/auth/refresh`, `/users/me`,
  `/sessions`, `/sessions/:id`, `/sessions/:id/metrics`,
  `/sessions/:id/events`, `/users/:id/calibration`.
- **Socket.IO** `/dashboard` namespace: `dashboard:subscribeUser`,
  `dashboard:subscribe` / `dashboard:unsubscribe`, and the server-pushed
  `session:started`, `metrics:update`, `feedback:logged`, `session:ended`.

`metrics:update` previously only carried rate/pause/classification fields —
`services/gateway/src/sockets/index.js` and `models/SpeechMetric.js` were
extended (additive, non-breaking) alongside this dashboard so the pitch,
loudness, voice-activity and composite-score fields the DSP pipeline already
computes (`app/pipeline/session_pipeline.py`) actually reach the UI and get
persisted for history backfill.

## Testing

```bash
npm test               # Vitest + React Testing Library, single run
npm run test:watch     # watch mode
npm run test:coverage  # adds a coverage report (text + HTML at coverage/index.html)
```

Tests are colocated as `*.test.tsx` next to the file they cover. `src/test/setup.ts` wires
`@testing-library/jest-dom`'s matchers and RTL's auto-cleanup (not automatic under Vitest, unlike Jest).
Coverage focuses on real logic rather than every file: presentational components with actual conditional
rendering (`Gauge`, `ClassificationBadge`, `SessionTimer`, `ConnectionBadge`, `Card`, `EmptyState`),
`AuthContext` (login/logout/session-restore), the data-fetching + live-socket hooks
(`useSessionQueries`, `useLiveSession`, `useReportQueries`), `HistoryTable` (including the
patient-vs-clinician Report column — download/generate/pending states), `LoginPage`, and `ProtectedRoute`.
Pure recharts wrappers and layout chrome are intentionally left untested — there's no conditional logic in
them to break.

## Structure

```
src/
  lib/            api client (axios + refresh), socket client, demo simulator,
                  dataClient (switches real/demo behind one interface)
  context/        AuthContext
  hooks/          React Query hooks + useLiveSession (the socket lifecycle)
  components/     layout, gauges, waveform, charts, status, history, calibration
  pages/          LoginPage, DashboardPage
```

The live-data path (`useLiveSession`) and the historical path (React Query)
merge into one rolling series (`useMergedSeries`) so charts backfill from
`GET /sessions/:id/metrics` on load and then keep growing from the socket.
