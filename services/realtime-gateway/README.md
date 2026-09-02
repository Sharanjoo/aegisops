# AegisOps Realtime Gateway

The AegisOps realtime gateway consumes validated incident lifecycle events from
Kafka and immediately broadcasts them to connected dashboard clients over
WebSockets.

## Event Flow

```text
Kubernetes failure
    -> Cluster agent
        -> Incident service
            -> MySQL and transactional outbox
                -> Kafka
                    -> Realtime gateway
                        -> WebSocket clients
```

## Current Capabilities

- Consumes incident events from Kafka using KafkaJS.
- Uses a dedicated Kafka consumer group.
- Validates incoming event JSON with Zod.
- Supports incident-created and incident-status-changed events.
- Rejects malformed JSON and unsupported event versions.
- Broadcasts validated events to all connected WebSocket clients.
- Tracks client connections and removes disconnected clients.
- Exposes HTTP health information.
- Produces structured JSON logs.
- Handles graceful shutdown of Kafka and HTTP resources.
- Runs as a non-root container with a read-only filesystem.
- Includes automated tests and GitHub Actions CI.

## Technology

- Node.js 22 LTS
- TypeScript
- Fastify
- WebSockets
- KafkaJS
- Zod
- Vitest
- Docker

## Endpoints

| Endpoint | Protocol | Purpose |
|---|---|---|
| `/health` | HTTP | Container and service health check |
| `/ws/incidents` | WebSocket | Incident lifecycle event stream |

Example health response:

```json
{
  "status": "UP",
  "service": "realtime-gateway"
}
```

## Kafka Contract

The gateway consumes:

```text
aegisops.incident.events.v1
```

The incident ID is used as the Kafka message key. This preserves ordering for
events belonging to the same incident.

Supported event types:

- `INCIDENT_CREATED`
- `INCIDENT_STATUS_CHANGED`

Supported schema version:

```text
1
```

Example event:

```json
{
  "eventId": "531bb2bd-5d6f-49c8-8348-455d8fcbe43a",
  "eventType": "INCIDENT_CREATED",
  "eventVersion": 1,
  "occurredAt": "2026-09-02T20:00:00Z",
  "incidentId": "cb28d76e-c55a-4b18-aeda-1af5c2e181bf",
  "serviceName": "cluster-agent-demo",
  "severity": "HIGH",
  "status": "OPEN",
  "previousStatus": null
}
```

## Configuration

| Environment variable | Default | Purpose |
|---|---|---|
| `AEGISOPS_GATEWAY_HOST` | `0.0.0.0` | HTTP and WebSocket bind address |
| `AEGISOPS_GATEWAY_PORT` | `8081` | Gateway listening port |
| `AEGISOPS_LOG_LEVEL` | `info` | Structured logging level |
| `AEGISOPS_KAFKA_BROKERS` | `localhost:9092` | Comma-separated Kafka brokers |
| `AEGISOPS_KAFKA_CLIENT_ID` | `aegisops-realtime-gateway` | Kafka client identifier |
| `AEGISOPS_KAFKA_GROUP_ID` | `aegisops-realtime-gateway-v1` | Kafka consumer group |
| `AEGISOPS_INCIDENT_TOPIC` | `aegisops.incident.events.v1` | Incident event topic |

## Local Development

Install dependencies:

```powershell
npm ci
```

Run in development mode:

```powershell
npm run dev
```

Build and run the compiled application:

```powershell
npm run build
npm start
```

Verify health:

```powershell
Invoke-RestMethod `
    -Uri "http://localhost:8081/health"
```

## WebSocket Test Client

Node.js includes a WebSocket client that can be used for manual testing:

```powershell
node -e "const ws = new WebSocket('ws://localhost:8081/ws/incidents'); ws.addEventListener('open', () => console.log('connected')); ws.addEventListener('message', event => console.log(JSON.stringify(JSON.parse(event.data), null, 2)));"
```

Only events received after the WebSocket connection is established are pushed
to the client. A dashboard should retrieve the current incident list through
the incident-service REST API before listening for subsequent updates.

## Validation

Incoming Kafka messages must:

- contain valid JSON
- match the version-one incident schema
- contain valid event and incident UUIDs
- use a supported event type
- include a valid ISO-8601 timestamp
- include non-empty service, severity and status values

Invalid events are logged and ignored so that malformed messages do not block
the Kafka partition.

## Tests

Run type checking:

```powershell
npm run typecheck
```

Run the test suite:

```powershell
npm test
```

Build the production output:

```powershell
npm run build
```

The tests cover:

- HTTP health responses
- WebSocket connection tracking
- broadcasting to connected clients
- client disconnection cleanup
- valid incident event parsing
- malformed JSON rejection
- unsupported version rejection
- unsupported event-type rejection
- Kafka subscription and valid event handling
- empty and invalid Kafka message handling

## Container Image

Build the image:

```powershell
docker build `
    --tag aegisops/realtime-gateway:dev `
    .
```

Run it with the local Kafka Docker network:

```powershell
docker run `
    --detach `
    --name aegisops-realtime-gateway `
    --network aegisops-local_default `
    --publish 8081:8081 `
    --read-only `
    --cap-drop ALL `
    --security-opt no-new-privileges:true `
    --memory 128m `
    --cpus 0.5 `
    --env AEGISOPS_KAFKA_BROKERS=kafka:19092 `
    aegisops/realtime-gateway:dev
```

The runtime container:

- uses Node.js 22 LTS
- runs as the non-root `node` user
- contains only production dependencies
- supports a read-only root filesystem
- includes a Docker health check
- does not require Linux capabilities

## Delivery Semantics

The gateway is designed for live updates, not incident storage:

- MySQL remains owned exclusively by the incident service.
- Kafka provides durable event transport.
- The gateway does not directly access MySQL.
- Connected clients receive new validated events.
- Disconnected clients do not receive replayed WebSocket messages.
- Dashboard state is restored through the incident-service REST API.