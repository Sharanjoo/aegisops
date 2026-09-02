# AegisOps Incident Dashboard

React and TypeScript operator dashboard for AegisOps incidents. Loads the
current incident snapshot from the incident service's REST API, then keeps
it live with events from the realtime gateway's WebSocket stream.

## Architecture

```text
Incident service REST API (GET /api/v1/incidents)
    -> initial incident snapshot
        -> dashboard state (src/state/incidentsReducer.ts)
            <- realtime gateway WebSocket (/ws/incidents)
               INCIDENT_CREATED / INCIDENT_STATUS_CHANGED events
```

REST and WebSocket play different, non-overlapping roles:

- **REST** (`services/incident-service`) is the source of truth for which
  incidents exist and their full details (title, description, timestamps).
  It is fetched once on load.
- **WebSocket** (`services/realtime-gateway`) only pushes *changes* going
  forward - it is not queried for history, and disconnected clients do not
  receive replayed messages (see the realtime gateway's own README under
  "Delivery Semantics"). The dashboard never treats the socket as storage:
  losing the connection means missing live updates, not losing data, and
  reconnecting resumes the stream without re-fetching the snapshot.

Code is split by responsibility:

| Concern | Location |
|---|---|
| REST client + response validation | `src/api/incidentApi.ts` |
| WebSocket lifecycle + backoff | `src/realtime/useIncidentSocket.ts` |
| Event schema validation | `src/realtime/validateIncidentEvent.ts` |
| State reconciliation (dedup, upsert) | `src/state/incidentsReducer.ts` |
| Search/filter logic | `src/state/filterIncidents.ts` |
| Snapshot + socket orchestration | `src/state/useIncidentDashboard.ts` |
| Presentational components | `src/components/` |

### Frontend representation differences

The realtime gateway's event payload (see `services/realtime-gateway/README.md`)
does not carry an incident's `title` or `description` - only the REST
snapshot does. If an `INCIDENT_CREATED` event arrives for an incident the
dashboard has not seen in its REST snapshot, it is inserted with
`title: null` and `description: null`, and the table shows "Details
pending…" until a future snapshot reload supplies them. `IncidentStatus`
and `IncidentSeverity` on the wire are also only validated by the gateway
as non-empty strings, not as members of the incident service's actual
enums; the dashboard defensively falls back to the incident's current
value for anything outside `LOW/MEDIUM/HIGH/CRITICAL` or
`OPEN/ACKNOWLEDGED/RESOLVED` rather than rendering (or crashing on) an
unrecognized value.

### Connection states

The header shows one of four states, driven by `useIncidentSocket`:

- **connecting** - first connection attempt after mount.
- **live** - the socket is open and receiving events.
- **disconnected** - the socket just closed; a retry is scheduled.
- **reconnecting** - a retry is in flight, following capped exponential
  backoff (1s, 2s, 4s, ... capped at 30s).

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `VITE_INCIDENT_API_BASE_URL` | `http://localhost:8080` | Incident service REST base URL |
| `VITE_REALTIME_WS_URL` | `ws://localhost:8081/ws/incidents` | Realtime gateway WebSocket URL |

Copy `.env.example` to `.env` to override either for your environment;
`.env` is git-ignored.

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
  /api/v1/incidents` for the snapshot. See `IncidentController` and the
  `Incident` domain record for the authoritative response shape.
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

## Current limitations

- No authentication - matches the rest of the MVP at this stage.
- No incident mutation controls (acknowledge/resolve) - read-only by
  design for this milestone.
- No Docker/Kubernetes packaging yet; that follows once the browser
  integration above has been verified against a real deployment target.
- The WebSocket dedup/event-id cache is capped at the most recent 1000
  event IDs (see `incidentsReducer.ts`) - sufficient for a live operator
  session, not for replaying arbitrary history.
