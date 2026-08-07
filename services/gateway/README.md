# Gateway Service

Node.js + Express + Socket.IO gateway for the real-time speech biofeedback system. Owns auth, session
lifecycle, persistence, and real-time fan-out between the phone client, the FastAPI DSP service, and the
dashboard client. See `/docs` (or the architecture spec) for the full system design.

## Setup

```bash
cp .env.example .env   # then fill in real secrets
npm install
npm run dev             # nodemon, auto-restart
npm start                # production
```

Requires Node >= 18 (uses the built-in `fetch`), a running MongoDB instance, and a reachable FastAPI DSP
service. Redis is optional — only needed once you run more than one gateway instance (see `REDIS_URL`).

## Testing

```bash
npm test                    # everything: unit + integration + sockets
npm run test:unit           # pure unit tests — no database
npm run test:integration    # Supertest against the real Express app + an in-memory MongoDB
npm run test:sockets        # Socket.IO client/server tests (device + dashboard namespaces)
npm run test:coverage       # adds a coverage report (text + HTML at coverage/index.html)
```

No setup needed beyond `npm install` — `tests/helpers/mongoServer.js` starts a `mongodb-memory-server`
instance (reusing a local MongoDB install if one's found, e.g. `C:/Program Files/MongoDB/Server/*/bin`,
otherwise downloading its own binary) once for the whole run, shared across all three Jest "projects"
(`jest.config.js`). Each test *file* connects to its own randomly-named database on that instance
(`tests/setup/db.js`) so files can run in parallel without racing each other's cleanup.

- **Unit** (`tests/unit/`): `ApiError`, `asyncHandler`, `tokenService`, the `validate`/`auth`/`errorHandler`/
  `notFound` middleware, and `config/db.js` — all with dependencies mocked, no I/O.
- **Integration** (`tests/integration/`): Supertest against `app.js` end to end — auth (register/login/
  refresh/logout token rotation), users + calibration (DSP client mocked), sessions (including the full
  fire-and-forget completion pipeline: summary → `AnalysisResult` → PDF `Report` → `Notification`s, polled
  via `tests/helpers/waitFor.js`), analysis-results, reports (including actually downloading and validating
  the generated PDF's bytes), and notifications.
- **Sockets** (`tests/sockets/`): a real `http.Server` + `initSocketServer` against `socket.io-client`, with
  `services/dspClient` swapped for `tests/sockets/fakeDspClient.js` (dsp-service has its own suite for the
  real DSP link) — namespace auth, `session:start`/`stop`, `audio:chunk` bounds-checking, dashboard
  subscribe/unsubscribe access control, and the full cross-namespace broadcast wiring (phone → gateway →
  dashboard metrics/feedback, and gateway → phone vibration commands), plus DSP-failure and
  disconnect-mid-session abort handling.

## Layout

```
src/
  config/      env validation, logger, MongoDB connection, Redis clients
  models/      Mongoose schemas (User, Profile, Device, Session, SpeechMetric, FeedbackEvent,
               AnalysisResult, Report, Notification)
  routes/      Express routers, mounted under /api/v1
  controllers/ Thin HTTP-layer glue between routes and services
  services/    Business logic — auth, users, sessions (DB), sessionManager (live orchestration), DSP clients
  sockets/     Socket.IO namespaces, per-event handlers, and JWT socket auth
  middleware/  auth, validation, rate limiting, error handling
  validation/  Joi schemas
  utils/       ApiError, asyncHandler, shared constants (roles, socket event names, ...)
```

### Collections

| Requested name | Model | Notes |
|---|---|---|
| Users | `User` | Auth + role (`patient`/`clinician`/`admin`). |
| Calibration | `Profile` | One per user; baseline speech-rate/pause thresholds. Exposed at `/users/:id/calibration`. |
| Speech Sessions | `Session` | One per recording session; embeds a lightweight `summary`. |
| Analysis Results | `AnalysisResult` | New. One `session_final` result per session — severity, classification breakdown, recommendations, baseline comparison — derived from `SpeechMetric` + `FeedbackEvent` at session end. See `/analysis-results`. |
| Reports | `Report` | New. Clinician/system-authored write-up covering one or more sessions/analysis results, with a draft → finalized workflow and sharing. See `/reports`. |
| Notifications | `Notification` | New. Per-user inbox (session complete, report ready, alerts, clinician messages), with read/unread state and optional TTL expiry. See `/notifications`. |

`SpeechMetric` and `FeedbackEvent` remain as the high-frequency raw time-series/event log that `AnalysisResult` is aggregated from — they are not renamed since they're already wired through the live Socket.IO path (`sessionManager.js`).

### PDF reports

`POST /reports/sessions/:sessionId/generate` (clinician/admin) renders a full clinical PDF for one session —
patient details, session details, a speech-metrics table, two hand-drawn charts (classification breakdown,
articulation-rate/pause-ratio over time), a baseline-comparison table, the detected condition, and
recommendations — via `services/pdf/reportPdfBuilder.js` (PDFKit; charts are vector-drawn, no canvas/native
dependency). The PDF is stored as a `Buffer` directly on the `Report` document (`pdf.data`, `select: false`
so ordinary queries never load it) and the report is marked `finalized`, firing a `report_ready`
notification. Calling it again for the same session regenerates the same report in place. `GET
/reports/:id/download` streams the stored PDF back with `Content-Disposition: attachment` — this is what the
dashboard's "Download report" button hits.

## REST API (`/api/v1`)

| Endpoint | Method | Auth | Purpose |
|---|---|---|---|
| `/health` | GET | none | Liveness/readiness — checks Mongo + DSP service |
| `/auth/register` | POST | none | Create account |
| `/auth/login` | POST | none | Issue access + refresh token |
| `/auth/refresh` | POST | none | Rotate access token |
| `/auth/logout` | POST | bearer | Revoke a refresh token |
| `/users/me` | GET/PATCH | bearer | Read/update own profile |
| `/users/:id/calibration` | GET/PUT | bearer | Read/write calibrated speech-rate baseline |
| `/sessions` | GET/POST | bearer | List / create sessions |
| `/sessions/:id` | GET/PATCH | bearer | Read / update (end) a session |
| `/sessions/:id/metrics` | GET | bearer | Paginated time-series for charts |
| `/sessions/:id/events` | GET | bearer | Feedback (vibration) event log |
| `/analysis-results` | GET/POST | bearer | List (own, or any as clinician/admin) / create a manual result (clinician/admin) |
| `/analysis-results/:id` | GET/DELETE | bearer | Read / delete a result (owner or clinician/admin) |
| `/reports` | GET/POST | bearer | List (own, or any as clinician/admin) / create (clinician/admin) |
| `/reports/:id` | GET/PATCH/DELETE | bearer | Read (owner/author/clinician/admin/shared) / update / delete (author or clinician/admin) |
| `/reports/:id/share` | POST | bearer | Share a report with another user (clinician/admin) |
| `/reports/:id/download` | GET | bearer | Stream the stored PDF (owner/author/clinician/admin/shared) |
| `/reports/sessions/:sessionId/generate` | POST | bearer | Generate/regenerate a session's PDF report (clinician/admin) |
| `/notifications` | GET/POST | bearer | List own notifications / send one to a user (clinician/admin) |
| `/notifications/:id/read` | PATCH | bearer | Mark a notification read (owner) |
| `/notifications/read-all` | POST | bearer | Mark all of the caller's notifications read |
| `/notifications/:id` | DELETE | bearer | Delete a notification (owner) |

All error responses: `{ success: false, error: { code, message, details? } }`.

## Socket.IO

Two namespaces, JWT passed as `auth: { token }` on connect:

- **`/device`** (phone): `session:start`, `audio:chunk` (binary), `device:heartbeat`, `session:stop`
  → receives `session:ack`, `vibration:command`, `session:error`
- **`/dashboard`** (laptop): `dashboard:subscribeUser`, `dashboard:subscribe`, `dashboard:unsubscribe`
  → receives `session:started`, `metrics:update`, `feedback:logged`, `session:ended`

Full event contracts live in `src/utils/constants.js` (`SOCKET_EVENTS`) and the architecture spec §06.

## Audio → analysis → feedback path

1. Phone emits `session:start` → gateway creates a `Session` doc, loads the caller's calibration
   `Profile`, and opens a per-session WebSocket to FastAPI (`services/dspClient.js`).
2. Phone streams `audio:chunk` binary frames → `sessionManager.recordAudioChunk` forwards them onto that
   WebSocket.
3. FastAPI streams back `metrics` frames → `sessionManager` persists a `SpeechMetric`, and — when the
   frame is flagged `triggerFeedback` — persists a `FeedbackEvent` and fires a `vibration:command` at the
   originating phone socket.
4. Every `metrics` and `feedback` event is also broadcast to `dashboard` sockets subscribed to that
   session's room.
5. `session:stop` (or a device disconnect, or an unrecoverable DSP failure) ends the session, computes
   the summary aggregate, and broadcasts `session:ended`. On a clean `completed` end, this also
   (best-effort, logged not thrown on failure) generates the session's final `AnalysisResult`, fires a
   `session_completed` `Notification`, and renders + stores the downloadable PDF `Report` (firing its own
   `report_ready` `Notification`) — see `sessionService.endSession`.

This orchestration lives entirely in `services/sessionManager.js`, which is transport-agnostic — it emits
plain Node events that `sockets/index.js` wires onto actual `io.emit()` calls, so the same code path
handles a clean stop and a crash-abort identically.
