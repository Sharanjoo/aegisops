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
| Container images (incident service, realtime gateway, dashboard, cluster agent) | Complete |
| Kubernetes manifests (Kustomize, local kind deployment) | Complete |
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
│   ├── local/                 # Docker Compose for MySQL + Kafka
│   ├── kubernetes/            # Kustomize manifests (base + kind-local overlay)
│   └── scripts/               # deploy-kind.ps1, verify-kind.ps1
├── apps/
│   └── dashboard/             # React: read-only incident dashboard
├── services/
│   ├── cluster-agent/         # Go: Kubernetes failure detection
│   ├── incident-service/      # Java/Spring Boot: incident REST API
│   └── realtime-gateway/      # Node.js: Kafka-to-WebSocket bridge
└── .github/workflows/         # Per-service/app CI, plus Kubernetes manifest CI
```

## Prerequisites

- Docker Desktop (MySQL, Kafka, integration test containers, and the
  application container images below)
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

## Container Images

The incident service and dashboard each have a production-oriented,
multi-stage Dockerfile - non-root runtime user, pinned base image
versions, and a container `HEALTHCHECK`. Full details (build args, runtime
environment variables, image inspection) are in each service's own
README; this is the quick path.

Build both images:

```powershell
docker build -t aegisops/incident-service:dev .\services\incident-service
docker build -t aegisops/dashboard:dev .\apps\dashboard
```

Or run the whole stack - MySQL, Kafka, the incident service, the realtime
gateway, and the dashboard - as containers on one Docker network:

```powershell
docker compose -f .\infrastructure\local\compose.yaml up -d --build
```

The dashboard is then reachable at `http://localhost:8090`. Its nginx
runtime reverse-proxies `/api/*` and `/ws/incidents` to the incident
service and realtime gateway over the compose network - the browser never
talks to those container names directly, and the same image works behind
any origin without a rebuild (see
[`apps/dashboard/README.md`](apps/dashboard/README.md#container-image)).

Kubernetes manifests that consume these images - for local kind
deployment - are documented in **Kubernetes Deployment (kind)** below.

## Kubernetes Deployment (kind)

Deploys the full stack - MySQL, Kafka, incident service, realtime gateway,
dashboard, and cluster agent - into the local kind cluster using
Kustomize. This is local development infrastructure: single-instance
MySQL, single-broker Kafka, no ingress controller, no HA. See
[`docs/architecture.md`](docs/architecture.md#kubernetes-deployment-kind)
for the full topology and design rationale.

### Prerequisites

In addition to the Prerequisites above: a running kind cluster (see
[`infrastructure/kind/cluster.yaml`](infrastructure/kind/cluster.yaml) and
[`services/cluster-agent/README.md`](services/cluster-agent/README.md) for
creating one) and `kubectl` pointed at it.

### Directory Structure

```text
infrastructure/kubernetes/
├── base/                        # Reusable per-component manifests
│   ├── namespace/                 # aegisops-system + Pod Security labels
│   ├── mysql/                     # StatefulSet + headless Service
│   ├── kafka/                     # StatefulSet + headless Service (KRaft)
│   ├── kafka-topic-init/          # Job: idempotent topic provisioning
│   ├── incident-service/          # Deployment + Service + ConfigMap
│   ├── realtime-gateway/          # Deployment + Service + ConfigMap
│   ├── dashboard/                 # Deployment + Service + ConfigMap
│   └── cluster-agent/             # References services/cluster-agent's
│                                   # RBAC + Deployment, plus one patch
└── overlays/kind-local/         # Staged Kustomizations, applied in order
    ├── 00-namespace/
    ├── 10-infrastructure/         # MySQL + Kafka
    ├── 20-kafka-topic-init/
    ├── 30-application/            # incident-service, realtime-gateway,
    │                               # dashboard, cluster-agent
    └── .env.example                # Tracked placeholders for the local Secret
```

Each staged directory is independently valid: `kubectl kustomize <dir>`
and `kubectl apply --dry-run=client --validate=false -k <dir>` (against a
live cluster context) both work per-stage.

### Secret Setup

Copy the example and fill in real local values:

```powershell
Copy-Item .\infrastructure\kubernetes\overlays\kind-local\.env.example `
    .\infrastructure\kubernetes\overlays\kind-local\.env
```

`.env` is git-ignored (never commit it). `deploy-kind.ps1` reads
`MYSQL_DATABASE`, `MYSQL_USER`, `MYSQL_PASSWORD`, and `MYSQL_ROOT_PASSWORD`
from already-set environment variables first, falling back to this file,
and fails with a clear error if any are missing. It creates/updates the
`aegisops-secrets` Secret via
`kubectl create secret ... --dry-run=client -o yaml | kubectl apply -f -`
- values are never logged.

### Deploy

```powershell
pwsh infrastructure/scripts/deploy-kind.ps1
```

Idempotent and safe to re-run: builds all four `:dev` images, loads them
into the kind cluster, applies the namespace and Secret, applies MySQL and
Kafka and waits for both to become ready, provisions the
`aegisops.incident.events.v1` topic, applies the four application
workloads, and waits for every rollout. Pass `-SkipBuild` to redeploy
already-built images without rebuilding.

### Verify

```powershell
pwsh infrastructure/scripts/verify-kind.ps1
```

Read-only: prints workload/Service/StatefulSet/PVC/Job status and checks
non-root, dropped capabilities, ServiceAccount token restriction (only
cluster-agent should have one), probes, and resource requests/limits
across every pod.

### Reach the Dashboard

```powershell
kubectl port-forward -n aegisops-system svc/dashboard 8080:8080
```

Then open `http://localhost:8080`. The browser only ever talks to the
dashboard's own origin - `/api/v1/*` and `/ws/incidents` are reverse-proxied
in-cluster to `incident-service:8080` and `realtime-gateway:8081`, exactly
as in the Docker Compose deployment above.

### Manual End-to-End Test

With the port-forward above running:

```powershell
kubectl run crashloop-demo `
    --image=busybox:1.36.1 `
    --restart=Always `
    --labels="app.kubernetes.io/name=crashloop-demo" `
    --command -- sh -c "exit 1"

# Wait ~30-60s for CrashLoopBackOff, then:
kubectl logs -n aegisops-system deployment/cluster-agent --since=5m
curl http://localhost:8080/api/v1/incidents

kubectl delete pod crashloop-demo --ignore-not-found
```

The cluster agent detects the CrashLoopBackOff, creates an incident via
the incident service's REST API, the incident service publishes it to
Kafka, the realtime gateway consumes it and broadcasts over
`/ws/incidents`, and the dashboard reflects it live.

### Troubleshooting

```powershell
kubectl get pods,services,statefulsets,jobs,pvc -n aegisops-system -o wide
kubectl describe pod <pod-name> -n aegisops-system
kubectl logs -n aegisops-system deployment/<name> --tail=100
```

### Cleanup

Three distinct levels - know which one you mean before running any of
them:

```powershell
# 1. Remove only the manual test pod above (always safe):
kubectl delete pod crashloop-demo --ignore-not-found

# 2. Remove only the application Deployments (MySQL/Kafka data and the
#    namespace are untouched; re-running deploy-kind.ps1 restores them):
kubectl delete -k infrastructure/kubernetes/overlays/kind-local/30-application

# 3. DESTRUCTIVE - deletes all persisted incident and Kafka data:
kubectl delete -k infrastructure/kubernetes/overlays/kind-local/10-infrastructure
kubectl delete pvc -l app.kubernetes.io/part-of=aegisops -n aegisops-system

# Deleting the whole namespace is more destructive still - it also
# removes cluster-agent's RBAC - and is never done by any script here.
```

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
  placeholder values) are tracked. The Kubernetes Secret follows the same
  pattern - see **Secret Setup** above.
- **Kubernetes Pod Security `restricted` compliance**: every application
  pod in the kind deployment runs non-root with a pinned UID/GID, drops
  all Linux capabilities, disables privilege escalation, and (where the
  base image supports it) uses a read-only root filesystem; only
  cluster-agent - the one workload that calls the Kubernetes API - mounts
  a ServiceAccount token.

## Roadmap (Planned, Not Implemented)

- Incident mutation controls (acknowledge/resolve) from the dashboard, and
  authentication in front of it.
- Python/FastAPI detection service consuming Prometheus metrics.
- Go remediation engine with operator-approved, policy-bounded actions.
- Prometheus metrics collection and Grafana dashboards.
- Retry topics, dead-letter topics, and distributed tracing.
- Helm charts and Terraform/AWS deployment (Kubernetes manifests for local
  kind development are complete - see **Kubernetes Deployment (kind)**
  above).

See [`docs/architecture.md`](docs/architecture.md) for the full target
architecture diagram and implementation order.

## Service Documentation

- [Cluster agent](services/cluster-agent/README.md)
- [Incident service](services/incident-service/README.md)
- [Realtime gateway](services/realtime-gateway/README.md)
- [Dashboard](apps/dashboard/README.md)

## License

[MIT](LICENSE)
