# AegisOps Incident Dashboard

React and TypeScript operator dashboard for AegisOps incidents. Loads the
current incident snapshot from the incident service's REST API, then
reconciles it against compact WebSocket change notifications - each one
triggers a REST fetch of the complete incident before anything reaches the
screen.

## Architecture

```text
Incident service REST API (GET /api/v1/incidents)
    -> initial incident snapshot
        -> dashboard state (src/state/incidentsReducer.ts)
            <- realtime gateway WebSocket (/ws/incidents)
               compact INCIDENT_CREATED / INCIDENT_STATUS_CHANGED notifications
                   -> GET /api/v1/incidents/{incidentId}
                       -> complete incident upserted into dashboard state
```

REST is the only source of displayable incident data; the WebSocket is
only ever a *notification* channel:

- **REST** (`services/incident-service`) is the source of truth for every
  incident field. `GET /api/v1/incidents` loads the initial snapshot, and
  `GET /api/v1/incidents/{incidentId}` is what actually populates or
  updates a row - always, for both event types.
- **WebSocket** (`services/realtime-gateway`) only pushes compact *change
  notifications* - `eventId`, `eventType`, `incidentId` and a few other
  fields (see `types/incident.ts`), never the fields a row needs to
  display. Every valid notification triggers a detail fetch; the
  notification's own fields are never written into dashboard state. See
  **Event reconciliation model** below for the full sequence, including
  deduplication, retry, and reconnection recovery.

Code is split by responsibility:

| Concern | Location |
|---|---|
| REST client + response validation | `src/api/incidentApi.ts` |
| WebSocket lifecycle + backoff | `src/realtime/useIncidentSocket.ts` |
| Event schema validation | `src/realtime/validateIncidentEvent.ts` |
| State reconciliation (dedup, timestamp-aware upsert) | `src/state/incidentsReducer.ts` |
| Search/filter logic | `src/state/filterIncidents.ts` |
| Snapshot + socket orchestration, hydration, retry | `src/state/useIncidentDashboard.ts` |
| Presentational components | `src/components/` |

### Event reconciliation model

WebSocket messages are **notifications that something changed**, not
incident records - `eventId`, `eventType`, `incidentId`, and a few other
compact fields (see `types/incident.ts`), never the fields a row needs to
display. The dashboard does not claim exactly-once delivery of anything;
instead it treats the incident service as the one source of truth and
continuously reconciles toward it, tolerating dropped, delayed, or
redelivered notifications along the way.

**Normal path - per-event hydration:**

1. On mount, load the initial snapshot from `GET /api/v1/incidents`.
   WebSocket notifications that arrive before this succeeds are buffered
   (bounded and deduplicated - see below), not processed immediately or
   dropped, and are replayed once it does.
2. For every valid, not-yet-processed `INCIDENT_CREATED` or
   `INCIDENT_STATUS_CHANGED` notification: fetch the complete incident via
   `GET /api/v1/incidents/{incidentId}` and upsert that REST response into
   state. This applies equally whether or not the incident was already in
   the snapshot - an incident created entirely after page load is fetched
   and inserted the same way an update to a known incident is applied.
3. A notification is marked processed (added to a capped 1,000-entry
   `eventId` cache) only once its incident has actually been hydrated and
   applied - never before, and never for a notification whose hydration
   failed.
4. A failed detail fetch retries up to 3 times with capped backoff (500ms,
   1000ms). A notification that never succeeds is not marked processed, so
   a later redelivery can still recover it - but exhausting these retries
   also falls back to the reconciliation refresh below, so recovery does
   not depend on redelivery happening at all.
5. A duplicate or redelivered notification for an `eventId` already
   processed - or still being hydrated - is ignored; only one detail fetch
   is ever in flight per `eventId`.

**Fallback path - coalesced snapshot reconciliation:**

One mechanism (`triggerReconciliationRefresh` in `useIncidentDashboard.ts`)
handles every situation where the per-event path alone cannot be trusted
to recover state:

- a detail hydration that exhausts its retries (step 4 above),
- the startup buffer overflowing its cap (see below), and
- the WebSocket reconnecting after a disconnection (not the first
  connection - the initial snapshot and buffered events already cover
  that window).

Whichever of these triggers it, the refresh re-fetches
`GET /api/v1/incidents` and merges it into state incident-by-incident.
Concurrent triggers share one in-flight refresh cycle rather than each
starting a separate request. If it fails, it retries up to 3 times with
capped backoff (1s, 2s); if every attempt fails, a non-fatal warning
appears in the dashboard (`ReconciliationBanner`) with a manual "Retry"
action, which reuses the same mechanism. A later successful refresh -
automatic or manual - clears that warning. One failed live update, or one
failed refresh cycle, never blanks the already-loaded dashboard.

**Timestamp safety, applied everywhere an incident is written into
state** (hydration, the initial snapshot's per-incident upserts do not
need it since state starts empty, and every reconciliation-refresh merge):
the incoming incident's `updatedAt` is compared against whatever is
already in state. A strictly newer `updatedAt` replaces it; a strictly
older one is discarded; an **equal** `updatedAt` also retains the existing
value rather than letting network arrival order decide the winner. This
is what stops a slow or replayed REST response from regressing state a
faster or newer response already established.

**Startup buffer:** capped at 500 entries and deduplicated by `eventId`.
A notification that would exceed the cap is dropped, but that loss is
recorded and covered by the same reconciliation refresh once the initial
snapshot succeeds - recovery does not depend on knowing which specific
notification overflowed.

`IncidentStatus` and `IncidentSeverity` in the notification are only
validated by the realtime gateway as non-empty strings, not as members of
the incident service's actual enums - but since the notification's fields
are never written into dashboard state (only the REST response is), this
cannot produce an incident with an invalid severity or status; an
out-of-range value simply never survives to influence what is displayed.

### Connection states

The header shows one of four states, driven by `useIncidentSocket`:

- **connecting** - first connection attempt after mount.
- **live** - the socket is open and receiving events.
- **disconnected** - the socket just closed; a retry is scheduled.
- **reconnecting** - a retry is in flight, following capped exponential
  backoff (1s, 2s, 4s, ... capped at 30s).

## Environment variables

`VITE_*` variables are read by Vite at **build** time and baked into the
compiled bundle - they cannot change after the app is built. Their default
depends on the build mode:

| Variable | Dev default (`npm run dev`) | Production build default (`npm run build`, and the container image) |
|---|---|---|
| `VITE_INCIDENT_API_BASE_URL` | `http://localhost:8080` | `` (empty - same origin) |
| `VITE_REALTIME_WS_URL` | `ws://localhost:8081/ws/incidents` | `/ws/incidents` (same origin) |

In development there is no reverse proxy in front of Vite's dev server, so
the defaults point straight at the services' documented local ports.
**Production intentionally does not** - a same-origin relative default
means the compiled bundle never has a specific host baked in, so the same
build works behind any origin. The container image's nginx runtime fills
that role: it serves the bundle and reverse-proxies `/api/*` and
`/ws/incidents` to whichever backends its own environment variables name
- see **Container Image** below. Copy `.env.example` to `.env` to override
either variable for local development; `.env` is git-ignored.

```powershell
Copy-Item .env.example .env
```

## Local startup

Requires the incident service (port 8080) and realtime gateway (port
8081) running, which in turn require MySQL and Kafka
(`infrastructure/local/compose.yaml`) - see the root `docs/architecture.md`
and each service's own README for how to start them.

```powershell
cd .\apps\dashboard
npm install
npm run dev
```

The dashboard runs at `http://localhost:5173`.

## Test and build commands

```powershell
npm run lint        # oxlint
npm run typecheck   # tsc -b
npm test            # vitest run
npm run build       # tsc -b && vite build
```

## Expected backend dependencies

- **Incident service** (`services/incident-service`, port 8080): `GET
  /api/v1/incidents` for the snapshot and `GET
  /api/v1/incidents/{incidentId}` to hydrate each WebSocket notification.
  See `IncidentController` and the `Incident` domain record for the
  authoritative response shape.
- **Realtime gateway** (`services/realtime-gateway`, port 8081): `/ws/incidents`
  for live `INCIDENT_CREATED` and `INCIDENT_STATUS_CHANGED` events.

### CORS

Browsers block cross-origin `fetch` calls by default, and the incident
service previously had no CORS policy at all, so this milestone added one
(`services/incident-service`'s `CorsConfiguration`, `AEGISOPS_CORS_ALLOWED_ORIGIN`,
defaulting to `http://localhost:5173`) - see that service's README for
details. The realtime gateway needed no change: browsers do not apply the
`fetch`/XHR CORS mechanism to WebSocket handshakes, and the gateway does
not otherwise restrict connections by origin.

## Container Image

`Dockerfile` is a multi-stage build: `node:22.23.2-alpine3.23` installs
with `npm ci` and runs `npm run build`, and only the compiled
`dist/` output is copied into an `nginxinc/nginx-unprivileged:1.29-alpine`
runtime stage - no Node.js, no source, no dev dependencies, no test files
in the final image. That image already runs as a non-root user and
listens on the unprivileged port 8080.

### Routing inside the container

nginx serves the static bundle and reverse-proxies same-origin routes to
runtime-configurable upstreams, resolved via nginx's built-in envsubst
templating at container start (`nginx.conf.template`,
`NGINX_ENVSUBST_FILTER=^AEGISOPS_` so only these two variables are
substituted - everything else, including nginx's own `$host`-style
variables, is left alone):

| Route | Proxied to | Variable |
|---|---|---|
| `/api/*` | Incident service | `AEGISOPS_INCIDENT_SERVICE_URL` (default `http://incident-service:8080`) |
| `/ws/incidents` | Realtime gateway, upgrade headers preserved | `AEGISOPS_REALTIME_GATEWAY_URL` (default `http://realtime-gateway:8081`) |
| everything else | `index.html` (SPA fallback) | n/a |
| `/health` | `200 OK` plain text | n/a |

The browser only ever talks to the dashboard's own origin - it never
connects to `incident-service` or `realtime-gateway` directly, which
would be unreachable/meaningless outside a container network anyway.

Build the image:

```powershell
cd .\apps\dashboard
docker build --tag aegisops/dashboard:dev .
```

Run it on the same Docker network as the incident service and realtime
gateway containers (`aegisops-local_default`):

```powershell
docker run --detach `
    --name aegisops-dashboard `
    --network aegisops-local_default `
    --publish 8090:8080 `
    --env AEGISOPS_INCIDENT_SERVICE_URL=http://incident-service:8080 `
    --env AEGISOPS_REALTIME_GATEWAY_URL=http://realtime-gateway:8081 `
    aegisops/dashboard:dev
```

Open `http://localhost:8090`. `infrastructure/local/compose.yaml` runs all
of this for you with `docker compose up -d dashboard`.

Inspect what shipped:

```powershell
docker inspect aegisops/dashboard:dev --format '{{.Config.User}}'
docker inspect aegisops/dashboard:dev --format '{{.Config.ExposedPorts}}'
docker inspect aegisops/dashboard:dev --format '{{.Config.Healthcheck}}'
```

This milestone is container packaging only - no Kubernetes manifests yet.
The same-origin proxy design exists specifically so that boundary is
clean: a future Kubernetes Ingress/Service only has to point
`AEGISOPS_INCIDENT_SERVICE_URL`/`AEGISOPS_REALTIME_GATEWAY_URL` at cluster
DNS names, with no dashboard code or rebuild involved.

## Current limitations

- No authentication - matches the rest of the MVP at this stage.
- No incident mutation controls (acknowledge/resolve) - read-only by
  design for this milestone.
- No Docker/Kubernetes packaging yet; that follows once the browser
  integration above has been verified against a real deployment target.
- The event-ID dedup cache is capped at the most recent 1,000 entries (see
  `incidentsReducer.ts`) - sufficient for a live operator session, not for
  replaying arbitrary history.
- Reconciliation (the fallback refresh used by hydration exhaustion,
  startup buffer overflow, and reconnection) always re-fetches the entire
  incident list, not just the affected incident(s) - simple and correct,
  but heavier than a targeted re-fetch under high event volume.
- If reconciliation itself is exhausted (backend unreachable for an
  extended period), the dashboard shows a non-fatal warning until a
  manual retry or a later automatic trigger succeeds; it does not retry
  indefinitely on its own.
