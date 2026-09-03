# AegisOps Incident Service

Spring Boot service responsible for creating, retrieving, persisting, and
managing the lifecycle of AegisOps incidents. The service publishes
versioned incident events to Apache Kafka using the transactional outbox
pattern.

## Technology

- Java 21
- Spring Boot 4
- Spring Web MVC
- Spring Data JPA
- MySQL 8.4
- Flyway
- Apache Kafka
- Transactional outbox
- Testcontainers
- Maven

## Architecture

```text
REST Controller
    -> Application Service
        -> MySQL transaction
            -> Incidents table
            -> Outbox events table

Scheduled Outbox Publisher
    -> Pending outbox events
        -> Apache Kafka
            -> Future consumers and remediation services
```

Incident changes and their corresponding events are committed in the same
MySQL transaction. This prevents an incident from being persisted without
its event being recorded.

## REST API

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/v1/incidents` | Create an incident |
| `GET` | `/api/v1/incidents` | List incidents |
| `GET` | `/api/v1/incidents/{incidentId}` | Retrieve an incident |
| `PATCH` | `/api/v1/incidents/{incidentId}/status` | Update incident status |
| `GET` | `/actuator/health` | Check service health |

## Incident Lifecycle

Supported status transitions:

```text
OPEN -> ACKNOWLEDGED -> RESOLVED
OPEN -----------------> RESOLVED
```

Sending the current status again is idempotent. Backward or invalid
transitions return HTTP `409 Conflict`.

## Kafka Events

Topic: `aegisops.incident.events.v1`

Current event types:

- `INCIDENT_CREATED`
- `INCIDENT_STATUS_CHANGED`

The Kafka record key is the incident ID. This preserves event ordering for
a specific incident within a Kafka partition.

Every event contains:

- Unique event ID
- Event type
- Schema version
- Event timestamp
- Incident ID
- Service name
- Severity
- Current status
- Previous status when applicable

## Delivery Semantics

The outbox publisher provides at-least-once delivery:

1. The incident and outbox event are committed atomically.
2. The publisher reads pending events.
3. Kafka acknowledges the publication.
4. The outbox row is marked `PUBLISHED`.
5. Failed publications remain `PENDING` and are retried.

Consumers should deduplicate events using `eventId` because an event can be
published more than once if Kafka succeeds but the database status update
fails.

## Run Locally

From the repository root, start MySQL and Kafka:

```powershell
docker compose `
    -f .\infrastructure\local\compose.yaml `
    up -d mysql kafka
```

Verify the containers:

```powershell
docker compose `
    -f .\infrastructure\local\compose.yaml `
    ps
```

Set the database password:

```powershell
$env:AEGISOPS_DB_PASSWORD = "aegisops_dev_password"
```

Start the service:

```powershell
cd .\services\incident-service
.\mvnw.cmd spring-boot:run -DskipTests
```

The service runs at `http://localhost:8080`.

## Configuration

| Environment variable | Default | Purpose |
|---|---|---|
| `AEGISOPS_DB_URL` | `jdbc:mysql://localhost:3307/aegisops...` | MySQL connection |
| `AEGISOPS_DB_USERNAME` | `aegisops` | MySQL username |
| `AEGISOPS_DB_PASSWORD` | Empty | MySQL password |
| `AEGISOPS_KAFKA_BOOTSTRAP_SERVERS` | `localhost:9092` | Kafka broker |
| `AEGISOPS_INCIDENT_EVENTS_TOPIC` | `aegisops.incident.events.v1` | Event topic |
| `AEGISOPS_OUTBOX_PUBLISH_INTERVAL_MS` | `1000` | Publisher interval |
| `AEGISOPS_CORS_ALLOWED_ORIGIN` | `http://localhost:5173` | Browser origin allowed to call `/api/v1/**` |

## CORS

The service allows cross-origin requests to `/api/v1/**` from exactly one
configured origin (`AEGISOPS_CORS_ALLOWED_ORIGIN`), defaulting to the local
Vite dashboard dev server. This is a local-development convenience, not a
production policy: a real deployment must set the environment variable to
the dashboard's actual origin rather than relying on the default, and there
is no wildcard (`*`) origin support.

## Run Tests

Docker must be running. Integration tests automatically start isolated MySQL
and Kafka containers.

```powershell
cd .\services\incident-service
.\mvnw.cmd clean test
```

## Container Image

`Dockerfile` is a multi-stage build: `eclipse-temurin:21.0.9_10-jdk-alpine`
compiles the jar with the Maven wrapper, and only the resulting jar is
copied into an `eclipse-temurin:21.0.9_10-jre-alpine` runtime stage - no
JDK, no build tooling, no source in the final image. The runtime process
runs as a dedicated non-root `aegisops` user, and the image `HEALTHCHECK`
polls the same `/actuator/health` endpoint used above.

Build the image:

```powershell
cd .\services\incident-service
docker build --tag aegisops/incident-service:dev .
```

Run it on the same Docker network as the local MySQL/Kafka containers
(`aegisops-local_default`, created by `infrastructure/local/compose.yaml`):

```powershell
docker run --detach `
    --name aegisops-incident-service `
    --network aegisops-local_default `
    --publish 8080:8080 `
    --env AEGISOPS_DB_URL="jdbc:mysql://mysql:3306/aegisops?useSSL=false&allowPublicKeyRetrieval=true&serverTimezone=UTC" `
    --env AEGISOPS_DB_USERNAME=aegisops `
    --env AEGISOPS_DB_PASSWORD=aegisops_dev_password `
    --env AEGISOPS_KAFKA_BOOTSTRAP_SERVERS=kafka:19092 `
    --env AEGISOPS_CORS_ALLOWED_ORIGIN=http://localhost:8090 `
    aegisops/incident-service:dev
```

`AEGISOPS_DB_PASSWORD` above is the clearly-labeled local dev password from
`infrastructure/local/.env.example` - substitute your own configuration's
value, never a real credential. Every value in this table is the same
runtime-configuration mechanism described in **Configuration** above; the
image hardcodes none of it, so the same image works in any environment
that supplies these variables. `infrastructure/local/compose.yaml` runs
all of this for you with `docker compose up -d incident-service`.

Inspect what shipped:

```powershell
docker inspect aegisops/incident-service:dev --format '{{.Config.User}}'
docker inspect aegisops/incident-service:dev --format '{{.Config.ExposedPorts}}'
docker inspect aegisops/incident-service:dev --format '{{.Config.Healthcheck}}'
```

This milestone is container packaging only - no Kubernetes manifests yet;
that is a separate, later milestone building on these images.
