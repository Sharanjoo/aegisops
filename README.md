# AegisOps

Event-driven, self-healing operations platform for Kubernetes
microservices. AegisOps detects failing Kubernetes workloads, turns them
into tracked incidents, and streams those incidents to a live dashboard in
real time over Kafka and WebSockets.

This repository is a portfolio project under active development. See
**Implementation Status** below for exactly what runs today versus what is
still on the roadmap — planned components are never described as working.

## Implementation Status

| Component | Status |
|---|---|
| Cluster agent (Go) — CrashLoopBackOff detection | Complete |
| Incident service (Java/Spring Boot) — REST API, MySQL, outbox | Complete |
| Realtime gateway (Node.js) — Kafka to WebSocket bridge | Complete |
| React dashboard | Complete (read-only foundation) |
| Remediation engine, detection service, Prometheus, Grafana | Planned |
| Helm, Terraform/AWS deployment | Planned |

The dashboard is read-only: no authentication and no incident mutation
controls (acknowledge/resolve) yet — see the Roadmap section below.

Full detail, including the current REST API, event schema, and database
tables, is in [`docs/architecture.md`](docs/architecture.md).

## Current Architecture

```text
Kubernetes workload failure
    -> Go cluster agent
        -> Java incident service REST API
            -> MySQL incidents and transactional outbox
                -> Kafka topic aegisops.incident.events.v1
                    -> Node.js realtime gateway
                        -> WebSocket clients (compact change notification)
                            -> GET /api/v1/incidents/{incidentId}
                                -> React dashboard (apps/dashboard)
```

The WebSocket notification only ever triggers a REST fetch of the complete
incident - it never supplies displayable fields itself. The dashboard also
calls the incident service's REST API directly once on page load for its
initial snapshot, and again after any WebSocket reconnection. See
[`docs/architecture.md`](docs/architecture.md#current-dashboard-behavior)
for the full reconciliation model.

## Implemented Components and Technologies

| Component | Technology | Port |
|---|---|---:|
| [Cluster agent](services/cluster-agent) | Go 1.27, client-go, Kubernetes informers | n/a (in-cluster watcher) |
| [Incident service](services/incident-service) | Java 21, Spring Boot 4, Spring Data JPA, Flyway, Kafka, Testcontainers | 8080 |
| [Realtime gateway](services/realtime-gateway) | Node.js 22, TypeScript, Fastify, WebSockets, KafkaJS, Zod | 8081 |
| [Dashboard](apps/dashboard) | React 19, TypeScript, Vite, Vitest | 5173 |
| Database | MySQL 8.4 | 3306 (3307 locally) |
| Event broker | Apache Kafka | 9092 |

## Repository Structure

```text
aegisops/
├── docs/
│   └── architecture.md        # Full architecture, current vs. planned
├── infrastructure/
│   ├── kind/                  # Local Kubernetes cluster config
│   └── local/                 # Docker Compose for MySQL + Kafka
├── apps/
│   └── dashboard/             # React: read-only incident dashboard
├── services/
│   ├── cluster-agent/         # Go: Kubernetes failure detection
│   ├── incident-service/      # Java/Spring Boot: incident REST API
│   └── realtime-gateway/      # Node.js: Kafka-to-WebSocket bridge
└── .github/workflows/         # Per-service/app CI
```

## Prerequisites

- Docker Desktop (MySQL, Kafka, and integration test containers)
- Java 21 and Maven (or use the included `mvnw` wrapper)
- Node.js 22 (see each Node project's `.nvmrc`)
- Go 1.27
- kubectl and [kind](https://kind.sigs.k8s.io/) for the cluster agent's
  local Kubernetes deployment

## Local Infrastructure Startup

Start MySQL and Kafka from the repository root:

```powershell
docker compose -f .\infrastructure\local\compose.yaml up -d mysql kafka
docker compose -f .\infrastructure\local\compose.yaml ps
```

## Service Startup Order

1. **MySQL and Kafka** — see above.
2. **Incident service** (needs MySQL and Kafka):
   ```powershell
   cd .\services\incident-service
   $env:AEGISOPS_DB_PASSWORD = "aegisops_dev_password"
   .\mvnw.cmd spring-boot:run -DskipTests
   ```
   Runs at `http://localhost:8080`.
3. **Realtime gateway** (needs Kafka):
   ```powershell
   cd .\services\realtime-gateway
   npm ci
   npm run dev
   ```
   Runs at `http://localhost:8081`.
4. **Dashboard** (needs the incident service and realtime gateway):
   ```powershell
   cd .\apps\dashboard
   npm install
   Copy-Item .env.example .env
   npm run dev
   ```
   Runs at `http://localhost:5173`.
5. **Cluster agent** (needs the incident service; optional for local
   development unless testing live Kubernetes detection):
   ```powershell
   cd .\services\cluster-agent
   go run ./cmd/agent
   ```
   See [`services/cluster-agent/README.md`](services/cluster-agent/README.md)
   for the full kind/Kubernetes deployment flow.

## Important Endpoints

| Service | Endpoint | Purpose |
|---|---|---|
| Incident service | `POST /api/v1/incidents` | Create an incident |
| Incident service | `GET /api/v1/incidents` | List incidents |
| Incident service | `GET /api/v1/incidents/{incidentId}` | Retrieve an incident |
| Incident service | `PATCH /api/v1/incidents/{incidentId}/status` | Update incident status |
| Incident service | `GET /actuator/health` | Health check |
| Realtime gateway | `GET /ws/incidents` (WebSocket) | Live incident event stream |
| Realtime gateway | `GET /health` | Health check |
| Dashboard | `http://localhost:5173` | Read-only operator UI |

## Kafka Topic and Event Types

Topic: `aegisops.incident.events.v1` (incident ID is the message key)

Event types: `INCIDENT_CREATED`, `INCIDENT_STATUS_CHANGED`

Each event is flat and contains `eventId`, `eventType`, `eventVersion`,
`occurredAt`, `incidentId`, `serviceName`, `severity`, `status`, and
`previousStatus` — see
[`docs/architecture.md`](docs/architecture.md#current-event-contract) for
the full contract and the dashboard's actual reconciliation model.

## Tests

**Incident service** (Docker required — integration tests use
Testcontainers):

```powershell
cd .\services\incident-service
.\mvnw.cmd clean test
```

**Cluster agent**:

```powershell
cd .\services\cluster-agent
go test ./...
go vet ./...
```

**Realtime gateway**:

```powershell
cd .\services\realtime-gateway
npm ci
npm run typecheck
npm test
```

**Dashboard**:

```powershell
cd .\apps\dashboard
npm install
npm run lint
npm run typecheck
npm test
```

## Reliability and Security Decisions (Implemented)

- **Transactional outbox**: an incident and its outbound event commit in
  the same MySQL transaction, so the two can never disagree.
- **At-least-once Kafka delivery**: a scheduled publisher retries any event
  still marked `PENDING`; consumers must deduplicate using `eventId` (the
  dashboard does this with a capped 1,000-entry cache).
- **Ordered delivery per incident**: the incident ID is the Kafka message
  key.
- **Schema validation at the consumer boundary**: the realtime gateway
  validates every Kafka message against the version-1 event schema with
  Zod and drops anything invalid instead of crashing or forwarding it; the
  dashboard independently re-validates every WebSocket message it receives.
- **Single-origin CORS**: the incident service accepts cross-origin REST
  calls from exactly one configured origin
  (`AEGISOPS_CORS_ALLOWED_ORIGIN`), not a wildcard.
- **Least-privilege Kubernetes RBAC**: the cluster agent can only `get`,
  `list`, and `watch` Pods — it cannot delete, patch, or scale anything.
- **Non-root, read-only containers**: the cluster agent runs as a
  non-root, distroless, read-only-filesystem container with all Linux
  capabilities dropped, under the Kubernetes `restricted` Pod Security
  Standard.
- **No secrets in source control**: local credentials live in `.env` files
  that are git-ignored; only `.env.example` files (clearly non-production
  placeholder values) are tracked.

## Roadmap (Planned, Not Implemented)

- Incident mutation controls (acknowledge/resolve) from the dashboard, and
  authentication in front of it.
- Python/FastAPI detection service consuming Prometheus metrics.
- Go remediation engine with operator-approved, policy-bounded actions.
- Prometheus metrics collection and Grafana dashboards.
- Retry topics, dead-letter topics, and distributed tracing.
- Docker packaging for the incident service and dashboard, Helm charts,
  and Terraform/AWS deployment.

See [`docs/architecture.md`](docs/architecture.md) for the full target
architecture diagram and implementation order.

## Service Documentation

- [Cluster agent](services/cluster-agent/README.md)
- [Incident service](services/incident-service/README.md)
- [Realtime gateway](services/realtime-gateway/README.md)
- [Dashboard](apps/dashboard/README.md)

## License

[MIT](LICENSE)
